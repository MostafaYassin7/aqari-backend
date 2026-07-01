import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { MediaType } from '../../common/enums/media-type.enum';
import { Favorite, FavoriteTargetType } from '../engagement/entities/favorite.entity';
import { Like } from '../engagement/entities/like.entity';
import { MediaService } from '../media/media.service';
import { PropertyAdvertisementLicense } from '../property-advertisement-licenses/entities/property-advertisement-license.entity';
import { SearchService } from '../search/search.service';
import { User } from '../users/entities/user.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { QueryListingsDto } from './dto/query-listings.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ListingMedia } from './entities/listing-media.entity';
import { Listing } from './entities/listing.entity';
import { ListingsAlgoliaService } from './listings-algolia.service';

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingsRepo: Repository<Listing>,
    @InjectRepository(ListingMedia)
    private readonly mediaRepo: Repository<ListingMedia>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Favorite)
    private readonly favoritesRepo: Repository<Favorite>,
    @InjectRepository(Like)
    private readonly likesRepo: Repository<Like>,
    @InjectRepository(PropertyAdvertisementLicense)
    private readonly licensesRepo: Repository<PropertyAdvertisementLicense>,
    private readonly algolia: ListingsAlgoliaService,
    private readonly searchService: SearchService,
    private readonly mediaService: MediaService,
  ) {}

  // ─── HELPERS ────────────────────────────────────────────────────────────────

  private generateAdNumber(): string {
    const digits = Math.floor(100000 + Math.random() * 900000).toString().padStart(6, '0');
    return `AQ-${digits}`;
  }

  private async loadOwner(ownerId: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id: ownerId } });
  }

  async incrementMessageCount(listingId: string): Promise<void> {
    await this.listingsRepo.increment({ id: listingId }, 'messageCount', 1);
  }

  // ─── CREATE ─────────────────────────────────────────────────────────────────

  async createListing(ownerId: string, dto: CreateListingDto): Promise<Listing> {
    const pricePerMeter =
      dto.area > 0 ? Number(dto.totalPrice) / Number(dto.area) : null;

    // Extract fields that are not columns on Listing before spreading.
    // pricePerHalfDay is destructured out separately since it's a decimal
    // column (string | null) but a number on the DTO — same treatment as
    // totalPrice/pricePerMeter/commissionPercent/streetWidth below.
    const { licenseId, advertiserType, pricePerHalfDay, ...listingFields } = dto;

    // ── Pre-check license before creating listing ────────────────────────────
    // listingId = null ensures this license has not already been used
    let license: PropertyAdvertisementLicense | null = null;
    if (licenseId) {
      license = await this.licensesRepo.findOne({
        where: { id: licenseId, advertiserUserId: ownerId, listingId: IsNull() },
      });
      if (!license) {
        throw new BadRequestException(
          'معرّف الترخيص غير صحيح أو تم استخدامه مسبقاً',
        );
      }
    }

    // ── Determine listing status based on license type ───────────────────────
    // isExternallyValidated = true  → broker/host, validated via API → PUBLISHED
    // isExternallyValidated = false → owner/agent, needs admin review → PENDING
    // no licenseId + broker/host    → license is mandatory, reject
    // no licenseId + owner/agent    → user skipped license step       → DRAFT
    let status: ListingStatus;
    if (!license) {
      if (advertiserType === 'broker') {
        throw new BadRequestException('رقم ترخيص الإعلان مطلوب للمسوق العقاري');
      }
      if (advertiserType === 'host') {
        throw new BadRequestException('رخصة وزارة السياحة مطلوبة للمضيف');
      }
      status = ListingStatus.DRAFT;
    } else if (license.isExternallyValidated) {
      status = ListingStatus.PUBLISHED;
    } else {
      status = ListingStatus.PENDING;
    }

    const listing = this.listingsRepo.create({
      ...listingFields,
      ownerId,
      adNumber: this.generateAdNumber(),
      totalPrice: dto.totalPrice.toString(),
      area: dto.area.toString(),
      latitude: dto.latitude.toString(),
      longitude: dto.longitude.toString(),
      pricePerMeter: pricePerMeter?.toFixed(2) ?? null,
      commissionPercent: dto.commissionPercent?.toString() ?? null,
      streetWidth: dto.streetWidth?.toString() ?? null,
      pricePerHalfDay: pricePerHalfDay?.toString() ?? null,
      status,
      licenseId: licenseId ?? null,
    });

    const saved = await this.listingsRepo.save(listing) as Listing;

    // ── Media records ────────────────────────────────────────────────────────
    if (dto.mediaUrls && dto.mediaUrls.length > 0) {
      const mediaRecords = dto.mediaUrls.map((url, index) => {
        const isVideo = url.match(/\.mp4(\?|$)/i);
        return this.mediaRepo.create({
          listingId: saved.id,
          url,
          type: isVideo ? MediaType.VIDEO : MediaType.PHOTO,
          isCover: index === 0,
          order: index,
        });
      });
      await this.mediaRepo.save(mediaRecords);
      await this.listingsRepo.update(saved.id, { coverPhoto: dto.mediaUrls[0] });
    }

    // ── Handle license linking and lifecycle ─────────────────────────────────
    if (license) {
      license.listingId = saved.id;
      await this.licensesRepo.save(license);

      if (license.isExternallyValidated) {
        // مسوق / مضيف: externally validated → delete temporary record
        await this.licensesRepo.remove(license);
      }
      // مالك / وكيل: keep record permanently for admin review and audit trail
    }

    const full = await this.listingsRepo.findOneOrFail({
      where: { id: saved.id },
      relations: { category: true, media: true },
    });

    // Sync to Algolia only for externally-validated listings (broker/host).
    // Owner/agent listings sync after admin approves the license.
    if (license?.isExternallyValidated) {
      const owner = await this.loadOwner(ownerId);
      this.algolia.indexListing(full, owner).catch(() => null);
    }

    return full;
  }

  // ─── FIND ALL ───────────────────────────────────────────────────────────────

  async findAll(query: QueryListingsDto): Promise<{
    data: Listing[];
    total: number;
    page: number;
    pages: number;
  }> {
    const { page = 1, limit = 20, categoryId, city, ownerId, status } = query;

    const qb = this.listingsRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.category', 'category')
      .select([
        'l.id', 'l.title', 'l.adNumber', 'l.status', 'l.totalPrice',
        'l.pricePerMeter', 'l.area', 'l.bedrooms', 'l.bathrooms', 'l.city',
        'l.district', 'l.address', 'l.coverPhoto', 'l.listingType',
        'l.propertyType', 'l.viewCount', 'l.messageCount', 'l.createdAt',
        'category',
      ]);

    if (categoryId) qb.andWhere('l.categoryId = :categoryId', { categoryId });
    if (city) qb.andWhere('l.city = :city', { city });
    if (ownerId) qb.andWhere('l.ownerId = :ownerId', { ownerId });
    if (status) qb.andWhere('l.status = :status', { status });

    qb.orderBy('l.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, pages: Math.ceil(total / limit) };
  }

  // ─── FIND ONE ───────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Listing & { stats: { viewCount: number; messageCount: number; favoriteCount: number; likeCount: number } }> {
    const listing = await this.listingsRepo.findOne({
      where: { id },
      relations: { category: true, media: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const [favoriteCount, likeCount, owner] = await Promise.all([
      this.favoritesRepo.count({ where: { targetType: FavoriteTargetType.LISTING, targetId: id } }),
      this.likesRepo.count({ where: { listingId: id } }),
      this.usersRepo.findOne({
        where: { id: listing.ownerId },
        select: ['id', 'name', 'phone', 'profilePhoto', 'role'],
      }),
    ]);

    // Fire and forget view count increment
    this.listingsRepo.increment({ id }, 'viewCount', 1).catch(() => null);

    return Object.assign(listing, {
      __owner__: owner
        ? { name: owner.name, phone: owner.phone, profilePhoto: owner.profilePhoto, role: owner.role }
        : null,
      stats: {
        viewCount: listing.viewCount,
        messageCount: listing.messageCount,
        favoriteCount,
        likeCount,
      },
    });
  }

  // ─── UPDATE ─────────────────────────────────────────────────────────────────

  async update(
    id: string,
    userId: string,
    dto: UpdateListingDto,
  ): Promise<Listing> {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.ownerId !== userId)
      throw new ForbiddenException('Not the listing owner');

    const update: Partial<Listing> = { ...dto } as Partial<Listing>;

    const newPrice = dto.totalPrice ?? Number(listing.totalPrice);
    const newArea = dto.area ?? Number(listing.area);
    if (dto.totalPrice !== undefined || dto.area !== undefined) {
      update.pricePerMeter =
        newArea > 0 ? (newPrice / newArea).toFixed(2) : null;
    }

    await this.listingsRepo.update(id, update);
    const updated = await this.listingsRepo.findOneOrFail({
      where: { id },
      relations: { category: true },
    });

    const owner = await this.loadOwner(userId);
    this.algolia.indexListing(updated, owner).catch(() => null);

    return updated;
  }

  // ─── UPDATE STATUS ──────────────────────────────────────────────────────────

  async updateStatus(
    id: string,
    userId: string,
    status: ListingStatus,
    isAdmin = false,
  ): Promise<Listing> {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (!isAdmin && listing.ownerId !== userId)
      throw new ForbiddenException('Not the listing owner');

    listing.status = status;
    const updated = await this.listingsRepo.save(listing);

    if (status === ListingStatus.PUBLISHED) {
      const owner = await this.loadOwner(listing.ownerId);
      this.algolia.indexListing(updated, owner).catch(() => null);
      this.searchService.checkNewListing(updated).catch(() => null);
    } else if (
      status === ListingStatus.PAUSED ||
      status === ListingStatus.PAUSED_TEMP ||
      status === ListingStatus.EXPIRED
    ) {
      this.algolia.deleteListing(id).catch(() => null);
    }

    return updated;
  }

  // ─── REMOVE ─────────────────────────────────────────────────────────────────

  async remove(id: string, userId: string): Promise<void> {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.ownerId !== userId)
      throw new ForbiddenException('Not the listing owner');

    // Delete media files from GCP before soft-deleting
    const mediaRecords = await this.mediaRepo.find({ where: { listingId: id } });
    await Promise.allSettled(
      mediaRecords.map((m) => this.mediaService.deleteFile(m.url)),
    );

    await this.listingsRepo.softDelete(id);
    this.algolia.deleteListing(id).catch(() => null);
  }

  // ─── PROMOTION ──────────────────────────────────────────────────────────────

  async activatePromotion(
    listingId: string,
    promotionType: 'featured' | 'golden' | 'buyers_alert' | 'social_media',
    expiresAt: Date,
  ): Promise<void> {
    await this.listingsRepo.update(listingId, {
      isPromoted: true,
      isGolden: promotionType === 'golden',
      promotionType,
      promotionExpiresAt: expiresAt,
    });
    const listing = await this.listingsRepo.findOne({
      where: { id: listingId },
      relations: { category: true },
    });
    if (listing) {
      const owner = await this.loadOwner(listing.ownerId);
      this.algolia.indexListing(listing, owner).catch(() => null);
    }
  }

  async deactivatePromotion(listingId: string): Promise<void> {
    await this.listingsRepo.update(listingId, {
      isPromoted: false,
      isGolden: false,
      promotionType: null,
      promotionExpiresAt: null,
    });
    const listing = await this.listingsRepo.findOne({
      where: { id: listingId },
      relations: { category: true },
    });
    if (listing) {
      const owner = await this.loadOwner(listing.ownerId);
      this.algolia.indexListing(listing, owner).catch(() => null);
    }
  }

  async getGoldenListings(): Promise<Listing[]> {
    return this.listingsRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.category', 'category')
      .select(['l.id', 'l.title', 'l.adNumber', 'l.totalPrice', 'l.pricePerMeter',
        'l.area', 'l.bedrooms', 'l.city', 'l.district', 'l.coverPhoto',
        'l.listingType', 'l.propertyType', 'l.promotionExpiresAt', 'category'])
      .where('l.isGolden = true')
      .andWhere('l.isPromoted = true')
      .andWhere('l.promotionExpiresAt > :now', { now: new Date() })
      .andWhere('l.status = :status', { status: ListingStatus.PUBLISHED })
      .orderBy('l.promotionExpiresAt', 'DESC')
      .take(20)
      .getMany();
  }

  // ─── MY LISTINGS ────────────────────────────────────────────────────────────

  async getMyListings(
    userId: string,
    query: QueryListingsDto,
  ): Promise<{ data: Listing[]; total: number; page: number; pages: number }> {
    return this.findAll({ ...query, ownerId: userId });
  }

  // ─── SIMILAR ────────────────────────────────────────────────────────────────

  async getSimilarListings(id: string): Promise<Listing[]> {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Listing not found');

    return this.listingsRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.category', 'category')
      .where('l.propertyType = :propertyType', { propertyType: listing.propertyType })
      .andWhere('l.city = :city', { city: listing.city })
      .andWhere('l.status = :status', { status: ListingStatus.PUBLISHED })
      .andWhere('l.id != :id', { id })
      .orderBy('l.createdAt', 'DESC')
      .take(6)
      .getMany();
  }
}
