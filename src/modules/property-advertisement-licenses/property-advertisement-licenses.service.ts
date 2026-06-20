import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { ListingsAlgoliaService } from '../listings/listings-algolia.service';
import { Listing } from '../listings/entities/listing.entity';
import {
  NotificationReferenceType,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { CreatePropertyAdvertisementLicenseDto } from './dto/create-property-advertisement-license.dto';
import { UpdateLicenseReviewStatusDto } from './dto/update-license-review-status.dto';
import { PropertyAdvertisementLicense } from './entities/property-advertisement-license.entity';

@Injectable()
export class PropertyAdvertisementLicensesService {
  private readonly logger = new Logger(PropertyAdvertisementLicensesService.name);

  constructor(
    @InjectRepository(PropertyAdvertisementLicense)
    private readonly repo: Repository<PropertyAdvertisementLicense>,

    @InjectRepository(Listing)
    private readonly listingsRepo: Repository<Listing>,

    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    private readonly notificationsService: NotificationsService,
    private readonly algolia: ListingsAlgoliaService,
  ) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────────

  /**
   * createLicense — إنشاء سجل ترخيص إعلان عقاري
   *
   * Called when the user completes the license form step in the Add Listing
   * flow (before submitting the listing itself).
   * At this point the listing has NOT been created yet, so listingId = null.
   * listingId gets linked later when the listing is submitted in the final step.
   *
   * After saving, notifies all admin users (fire-and-forget) that a new
   * license is pending their review.
   *
   * @param userId - معرّف المستخدم صاحب الطلب
   * @param dto    - بيانات الترخيص المُدخَلة من المستخدم
   * @returns the created license object including its id.
   *          Flutter stores this id and passes it when creating the listing.
   */
  async createLicense(
    userId: string,
    dto: CreatePropertyAdvertisementLicenseDto,
  ): Promise<PropertyAdvertisementLicense> {
    // Enforce mutual exclusivity of owner ID number fields based on propertyOwnerIdType.
    // Only one of the three fields should ever be non-null; clear the others here
    // so stale values from a previous selection cannot pollute the saved record.
    if (dto.propertyOwnerIdType === 'national_id') {
      dto.ownerCommercialRegNumber = undefined;
      dto.ownerUnifiedNumber = undefined;
      // propertyOwnerBirthDate is required for national_id — left as-is
    } else if (dto.propertyOwnerIdType === 'commercial_registration') {
      dto.ownerNationalIdNumber = undefined;
      dto.ownerUnifiedNumber = undefined;
      dto.propertyOwnerBirthDate = undefined; // companies have no birth date
    } else if (dto.propertyOwnerIdType === 'unified_700') {
      dto.ownerNationalIdNumber = undefined;
      dto.ownerCommercialRegNumber = undefined;
      dto.propertyOwnerBirthDate = undefined; // corporations have no birth date
    }

    const license = this.repo.create({
      ...dto,
      advertiserUserId: userId,
      listingId: null,
      reviewStatus: 'pending',
    });

    const saved = await this.repo.save(license);

    // Notify admins asynchronously — failure must not break the response
    this.notifyAdminsOfNewLicense(saved.id).catch((err) =>
      this.logger.error(`Admin notification failed for license ${saved.id}`, err),
    );

    return saved;
  }

  // ─── LINK LISTING ────────────────────────────────────────────────────────────

  /**
   * linkListingToLicense — ربط الإعلان بسجل الترخيص
   *
   * Called from ListingsService when the user completes and submits the listing
   * form (final step of the Add Listing flow).
   * At this point the listing has just been created in the DB.
   * This method records the listing UUID on the license so the admin
   * can see and approve it together.
   *
   * @param licenseId - معرّف سجل الترخيص
   * @param listingId - معرّف الإعلان الجديد
   * @param userId    - يُستخدم للتحقق من أن صاحب الطلب هو نفسه من أنشأ الترخيص
   * @returns the updated license record
   */
  async linkListingToLicense(
    licenseId: string,
    listingId: string,
    userId: string,
  ): Promise<PropertyAdvertisementLicense> {
    const license = await this.repo.findOne({ where: { id: licenseId } });

    if (!license) {
      throw new NotFoundException('License not found');
    }

    // Only the user who created the license can link their listing to it
    if (license.advertiserUserId !== userId) {
      throw new ForbiddenException('Not authorized');
    }

    license.listingId = listingId;
    return this.repo.save(license);
  }

  // ─── ADMIN REVIEW ────────────────────────────────────────────────────────────

  /**
   * updateReviewStatus — مراجعة الترخيص (موافقة أو رفض)
   *
   * Called by an admin to approve or reject a pending license request.
   *
   * On approval:
   *   - Sets the linked listing status to PUBLISHED
   *   - Syncs the listing to Algolia so it appears in search results
   *   - Sends a push notification to the advertiser: 'تم نشر إعلانك'
   *
   * On rejection:
   *   - Sets the linked listing status to PAUSED
   *   - Removes the listing from Algolia search results
   *   - Sends a push notification to the advertiser with the rejection reason
   *
   * If listingId is null (user submitted license but not yet the listing),
   * the listing status update and Algolia sync are skipped — they will happen
   * when the admin reviews again after the listing is linked.
   *
   * @param licenseId - معرّف سجل الترخيص المراد مراجعته
   * @param adminId   - معرّف الأدمن الذي يقوم بالمراجعة
   * @param dto       - حالة المراجعة وسبب الرفض (إن وجد)
   * @returns the updated license record
   */
  async updateReviewStatus(
    licenseId: string,
    adminId: string,
    dto: UpdateLicenseReviewStatusDto,
  ): Promise<PropertyAdvertisementLicense> {
    const license = await this.repo.findOne({ where: { id: licenseId } });

    if (!license) {
      throw new NotFoundException('License not found');
    }

    // سبب الرفض مطلوب عند الرفض
    if (dto.reviewStatus === 'rejected' && !dto.rejectionReason?.trim()) {
      throw new BadRequestException(
        'Rejection reason is required when rejecting a license',
      );
    }

    license.reviewStatus = dto.reviewStatus;
    license.rejectionReason = dto.rejectionReason ?? null;
    license.reviewedAt = new Date();
    license.reviewedByAdminId = adminId;

    await this.repo.save(license);

    // Side effects only run when the listing has already been linked
    if (license.listingId) {
      if (dto.reviewStatus === 'approved') {
        await this.handleApproval(license);
      } else {
        await this.handleRejection(license, dto.rejectionReason!);
      }
    }

    return license;
  }

  // ─── ADMIN QUERIES ────────────────────────────────────────────────────────────

  /**
   * getAllLicenses — جميع طلبات الترخيص (للأدمن)
   *
   * Returns a paginated list of all licenses regardless of reviewStatus.
   * Accepts an optional status filter so the admin can view pending /
   * approved / rejected separately.
   * Enriched with advertiserUser and listing the same way as getPendingLicenses.
   *
   * @param page   - رقم الصفحة (1-based)
   * @param limit  - عدد السجلات في الصفحة
   * @param status - اختياري — filter by reviewStatus ('pending'|'approved'|'rejected')
   */
  async getAllLicenses(
    page: number,
    limit: number,
    status?: string,
  ): Promise<{
    data: (PropertyAdvertisementLicense & {
      advertiserUser: Partial<User> | null;
      listing: Partial<Listing> | null;
    })[];
    total: number;
    page: number;
    pages: number;
  }> {
    const where = status ? { reviewStatus: status } : {};

    const [licenses, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const userIds = [...new Set(licenses.map((l) => l.advertiserUserId))];
    const users = userIds.length
      ? await this.usersRepo.find({ where: { id: In(userIds) } })
      : [];
    const usersMap = new Map(users.map((u) => [u.id, u]));

    const listingIds = licenses
      .filter((l) => l.listingId)
      .map((l) => l.listingId!);
    const listings = listingIds.length
      ? await this.listingsRepo.find({ where: { id: In(listingIds) } })
      : [];
    const listingsMap = new Map(listings.map((l) => [l.id, l]));

    const data = licenses.map((lic) => {
      const user = usersMap.get(lic.advertiserUserId) ?? null;
      const listing = lic.listingId ? (listingsMap.get(lic.listingId) ?? null) : null;

      return Object.assign(lic, {
        advertiserUser: user
          ? { id: user.id, name: user.name, phone: user.phone, profilePhoto: user.profilePhoto, role: user.role }
          : null,
        listing: listing
          ? { id: listing.id, title: listing.title, city: listing.city, adNumber: listing.adNumber, status: listing.status }
          : null,
      });
    });

    return { data, total, page, pages: Math.ceil(total / limit) };
  }

  /**
   * getPendingLicenses — قائمة الطلبات المعلقة (للأدمن)
   *
   * Returns a paginated list of all licenses where reviewStatus = 'pending',
   * ordered oldest-first (FIFO) so the admin reviews in submission order.
   * Each record is enriched with:
   *   advertiserUser: { id, name, phone, profilePhoto, role }
   *   listing:        { id, title, city, adNumber, status } — only if linked
   *
   * @param page  - رقم الصفحة (1-based)
   * @param limit - عدد السجلات في الصفحة
   */
  async getPendingLicenses(
    page: number,
    limit: number,
  ): Promise<{
    data: (PropertyAdvertisementLicense & {
      advertiserUser: Partial<User> | null;
      listing: Partial<Listing> | null;
    })[];
    total: number;
    page: number;
    pages: number;
  }> {
    const [licenses, total] = await this.repo.findAndCount({
      where: { reviewStatus: 'pending' },
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Batch-load users to avoid N+1 queries
    const userIds = [...new Set(licenses.map((l) => l.advertiserUserId))];
    const users = userIds.length
      ? await this.usersRepo.find({ where: { id: In(userIds) } })
      : [];
    const usersMap = new Map(users.map((u) => [u.id, u]));

    // Batch-load listings (only those that have been linked)
    const listingIds = licenses
      .filter((l) => l.listingId)
      .map((l) => l.listingId!);
    const listings = listingIds.length
      ? await this.listingsRepo.find({ where: { id: In(listingIds) } })
      : [];
    const listingsMap = new Map(listings.map((l) => [l.id, l]));

    const data = licenses.map((lic) => {
      const user = usersMap.get(lic.advertiserUserId) ?? null;
      const listing = lic.listingId ? (listingsMap.get(lic.listingId) ?? null) : null;

      return Object.assign(lic, {
        advertiserUser: user
          ? {
              id: user.id,
              name: user.name,
              phone: user.phone,
              profilePhoto: user.profilePhoto,
              role: user.role,
            }
          : null,
        listing: listing
          ? {
              id: listing.id,
              title: listing.title,
              city: listing.city,
              adNumber: listing.adNumber,
              status: listing.status,
            }
          : null,
      });
    });

    return { data, total, page, pages: Math.ceil(total / limit) };
  }

  /**
   * getPendingLicensesCount — عدد الطلبات المعلقة
   *
   * Returns the total count of pending licenses.
   * Used by the admin dashboard badge to show unreviewed requests.
   */
  async getPendingLicensesCount(): Promise<{ count: number }> {
    const count = await this.repo.count({ where: { reviewStatus: 'pending' } });
    return { count };
  }

  /**
   * getMyLicenses — طلباتي (للمستخدم)
   *
   * Returns all license records submitted by the current user,
   * newest first, with listing details attached when linked.
   *
   * @param userId - معرّف المستخدم
   */
  async getMyLicenses(userId: string): Promise<
    (PropertyAdvertisementLicense & { listing: Partial<Listing> | null })[]
  > {
    const licenses = await this.repo.find({
      where: { advertiserUserId: userId },
      order: { createdAt: 'DESC' },
    });

    const listingIds = licenses
      .filter((l) => l.listingId)
      .map((l) => l.listingId!);
    const listings = listingIds.length
      ? await this.listingsRepo.find({ where: { id: In(listingIds) } })
      : [];
    const listingsMap = new Map(listings.map((l) => [l.id, l]));

    return licenses.map((lic) =>
      Object.assign(lic, {
        listing: lic.listingId ? (listingsMap.get(lic.listingId) ?? null) : null,
      }),
    );
  }

  // ─── PRIVATE ──────────────────────────────────────────────────────────────────

  /**
   * notifyAdminsOfNewLicense — إشعار الأدمن بطلب ترخيص جديد
   *
   * Private method called (fire-and-forget) after createLicense().
   * Finds all admin users and sends each a push notification so they
   * know a new license is waiting for their review.
   *
   * @param licenseId - معرّف سجل الترخيص الجديد
   */
  private async notifyAdminsOfNewLicense(licenseId: string): Promise<void> {
    const admins = await this.usersRepo.find({
      where: { role: UserRole.ADMIN },
    });

    await Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.createAndSend(
          admin.id,
          NotificationType.SYSTEM,
          'New License Pending Review',
          'A new listing license requires your approval',
          NotificationReferenceType.LISTING,
          licenseId,
        ),
      ),
    );
  }

  /**
   * handleApproval — نشر الإعلان بعد الموافقة على الترخيص
   *
   * Sets listing status to PUBLISHED, syncs to Algolia, and notifies
   * the advertiser that their listing is now live.
   */
  private async handleApproval(license: PropertyAdvertisementLicense): Promise<void> {
    await this.listingsRepo.update(license.listingId!, {
      status: ListingStatus.PUBLISHED,
    });

    // Load full listing with category (eager) for Algolia indexing
    const listing = await this.listingsRepo.findOne({
      where: { id: license.listingId! },
    });

    if (listing) {
      const owner = await this.usersRepo.findOne({
        where: { id: listing.ownerId },
      });
      this.algolia.indexListing(listing, owner).catch((err) =>
        this.logger.error(`Algolia index failed for listing ${listing.id}`, err),
      );
    }

    // إشعار المُعلن بأن إعلانه تم نشره
    this.notificationsService
      .createAndSend(
        license.advertiserUserId,
        NotificationType.LISTING_APPROVED,
        'تم نشر إعلانك',
        'تمت الموافقة على ترخيص إعلانك ونشره على منصة عقار',
        NotificationReferenceType.LISTING,
        license.listingId!,
      )
      .catch((err) =>
        this.logger.error(
          `Approval notification failed for user ${license.advertiserUserId}`,
          err,
        ),
      );
  }

  /**
   * handleRejection — إيقاف الإعلان بعد رفض الترخيص
   *
   * Sets listing status to PAUSED, removes it from Algolia search results,
   * and notifies the advertiser with the rejection reason.
   */
  private async handleRejection(
    license: PropertyAdvertisementLicense,
    rejectionReason: string,
  ): Promise<void> {
    await this.listingsRepo.update(license.listingId!, {
      status: ListingStatus.PAUSED,
    });

    // Remove from Algolia so the listing no longer appears in search
    this.algolia.deleteListing(license.listingId!).catch((err) =>
      this.logger.error(
        `Algolia delete failed for listing ${license.listingId}`,
        err,
      ),
    );

    // إشعار المُعلن بسبب رفض الترخيص
    this.notificationsService
      .createAndSend(
        license.advertiserUserId,
        NotificationType.SYSTEM,
        'تم رفض ترخيص إعلانك',
        rejectionReason,
        NotificationReferenceType.LISTING,
        license.listingId!,
      )
      .catch((err) =>
        this.logger.error(
          `Rejection notification failed for user ${license.advertiserUserId}`,
          err,
        ),
      );
  }
}
