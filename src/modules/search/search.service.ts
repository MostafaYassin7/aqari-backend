import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { algoliasearch, type SearchClient } from 'algoliasearch';
import { Repository } from 'typeorm';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Listing } from '../listings/entities/listing.entity';
import {
  NotificationReferenceType,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SaveSearchDto } from './dto/save-search.dto';
import { GeoSearchDto } from './dto/geo-search.dto';
import { GeoSearchProjectsDto } from './dto/geo-search-projects.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { SavedSearch } from './entities/saved-search.entity';
import { SearchAlert } from './entities/search-alert.entity';

@Injectable()
export class SearchService {
  private readonly client: SearchClient;
  private readonly indexName: string;
  private readonly projectsIndexName: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Listing)
    private readonly listingsRepo: Repository<Listing>,
    @InjectRepository(SavedSearch)
    private readonly savedSearchRepo: Repository<SavedSearch>,
    @InjectRepository(SearchAlert)
    private readonly searchAlertRepo: Repository<SearchAlert>,
    private readonly notificationsService: NotificationsService,
  ) {
    this.client = algoliasearch(
      config.get<string>('ALGOLIA_APP_ID')!,
      config.get<string>('ALGOLIA_API_KEY')!,
    );
    this.indexName = config.get<string>('ALGOLIA_LISTINGS_INDEX')!;
    this.projectsIndexName = config.get<string>('ALGOLIA_PROJECTS_INDEX')!;
  }

  // ─── FILTER BUILDER ─────────────────────────────────────────────────────────

  buildAlgoliaFilters(dto: SearchListingsDto): string {
    const parts: string[] = [`status:${ListingStatus.PUBLISHED}`];

    if (dto.city)         parts.push(`city:"${dto.city}"`);
    if (dto.district)     parts.push(`district:"${dto.district}"`);
    if (dto.propertyType) parts.push(`propertyType:${dto.propertyType}`);
    if (dto.excludePropertyType) parts.push(`NOT propertyType:${dto.excludePropertyType}`);
    if (dto.listingType)  parts.push(`listingType:${dto.listingType}`);
    if (dto.bedrooms != null) parts.push(`bedrooms >= ${dto.bedrooms}`);
    if (dto.maxGuests != null) parts.push(`maxGuests >= ${dto.maxGuests}`);
    if (dto.isFurnished)  parts.push(`isFurnished:true`);
    if (dto.hasElevator)  parts.push(`hasElevator:true`);
    if (dto.hasWater)     parts.push(`hasWater:true`);
    if (dto.hasElectricity) parts.push(`hasElectricity:true`);

    if (dto.priceFrom != null && dto.priceTo != null) {
      parts.push(`totalPrice:${dto.priceFrom} TO ${dto.priceTo}`);
    } else if (dto.priceFrom != null) {
      parts.push(`totalPrice >= ${dto.priceFrom}`);
    } else if (dto.priceTo != null) {
      parts.push(`totalPrice <= ${dto.priceTo}`);
    }

    if (dto.areaFrom != null && dto.areaTo != null) {
      parts.push(`area:${dto.areaFrom} TO ${dto.areaTo}`);
    } else if (dto.areaFrom != null) {
      parts.push(`area >= ${dto.areaFrom}`);
    } else if (dto.areaTo != null) {
      parts.push(`area <= ${dto.areaTo}`);
    }

    return parts.join(' AND ');
  }

  // ─── KEYWORD SEARCH ─────────────────────────────────────────────────────────

  async searchListings(dto: SearchListingsDto) {
    const { page = 1, limit = 20 } = dto;
    const filters = this.buildAlgoliaFilters(dto);

    const result = await this.client.searchSingleIndex({
      indexName: this.indexName,
      searchParams: {
        query: dto.query ?? '',
        filters,
        page: page - 1,
        hitsPerPage: limit,
      },
    });

    return {
      hits: this.sortHits(result.hits, dto.sortBy),
      total: result.nbHits,
      page,
      pages: result.nbPages,
    };
  }

  // ─── GEO SEARCH ─────────────────────────────────────────────────────────────

  async geoSearch(dto: GeoSearchDto) {
    const { page = 1, limit = 20, radiusKm = 5 } = dto;
    const filters = this.buildAlgoliaFilters(dto);

    const result = await this.client.searchSingleIndex({
      indexName: this.indexName,
      searchParams: {
        query: dto.query ?? '',
        filters,
        aroundLatLng: `${dto.latitude},${dto.longitude}`,
        aroundRadius: radiusKm * 1000,
        page: page - 1,
        hitsPerPage: limit,
      },
    });

    return {
      hits: this.sortHits(result.hits, dto.sortBy),
      total: result.nbHits,
      page,
      pages: result.nbPages,
    };
  }

  private sortHits<T extends Record<string, unknown>>(hits: T[], sortBy?: SearchListingsDto['sortBy']): T[] {
    if (!sortBy || sortBy === 'newest') return hits;

    const sorted = [...hits];
    const numberValue = (hit: T, key: string): number => Number(hit[key] ?? 0);
    const dateValue = (hit: T): number => {
      const value = hit['createdAt'] ?? hit['created_at'] ?? hit['updatedAt'];
      const time = typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : 0;
      return Number.isFinite(time) ? time : 0;
    };

    if (sortBy === 'oldest') {
      sorted.sort((a, b) => dateValue(a) - dateValue(b));
    } else if (sortBy === 'price_asc') {
      sorted.sort((a, b) => numberValue(a, 'totalPrice') - numberValue(b, 'totalPrice'));
    } else if (sortBy === 'price_desc') {
      sorted.sort((a, b) => numberValue(b, 'totalPrice') - numberValue(a, 'totalPrice'));
    }

    return sorted;
  }

  // ─── BY REFERENCE (PostgreSQL) ───────────────────────────────────────────────

  async searchByAdOrPhone(q: string): Promise<Listing[]> {
    return this.listingsRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.category', 'category')
      .leftJoin('l.owner', 'owner')
      .where('l.adNumber = :q', { q })
      .orWhere('owner.phone LIKE :phone', { phone: `%${q}%` })
      .andWhere('l.status = :status', { status: ListingStatus.PUBLISHED })
      .take(20)
      .getMany();
  }

  // ─── SAVED SEARCHES ──────────────────────────────────────────────────────────

  async saveSearch(userId: string, dto: SaveSearchDto): Promise<SavedSearch> {
    const record = this.savedSearchRepo.create({
      userId,
      name: dto.name ?? null,
      filters: dto.filters,
    });
    return this.savedSearchRepo.save(record);
  }

  async getSavedSearches(userId: string): Promise<SavedSearch[]> {
    return this.savedSearchRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteSavedSearch(userId: string, id: string): Promise<void> {
    const record = await this.savedSearchRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Saved search not found');
    if (record.userId !== userId) throw new ForbiddenException('Not your saved search');
    await this.savedSearchRepo.softDelete(id);
  }

  async toggleAlert(userId: string, id: string, enabled: boolean): Promise<SavedSearch> {
    const record = await this.savedSearchRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Saved search not found');
    if (record.userId !== userId) throw new ForbiddenException('Not your saved search');
    record.alertEnabled = enabled;
    return this.savedSearchRepo.save(record);
  }

  // ─── ALERT MATCHING ──────────────────────────────────────────────────────────

  private listingMatchesFilters(
    listing: Listing,
    filters: Record<string, unknown>,
  ): boolean {
    // Helper: field is present in filters AND has a non-null value
    const has = (key: string): boolean =>
      key in filters && filters[key] !== null && filters[key] !== undefined;

    if (has('city') && listing.city !== filters['city']) return false;
    if (has('district') && listing.district !== filters['district']) return false;
    if (has('propertyType') && listing.propertyType !== filters['propertyType']) return false;
    if (has('excludePropertyType') && listing.propertyType === filters['excludePropertyType']) return false;
    if (has('listingType') && listing.listingType !== filters['listingType']) return false;
    if (has('bedrooms') && Number(listing.bedrooms) < Number(filters['bedrooms'])) return false;
    if (has('maxGuests') && Number(listing.maxGuests) < Number(filters['maxGuests'])) return false;
    if (has('priceFrom') && Number(listing.totalPrice) < Number(filters['priceFrom'])) return false;
    if (has('priceTo') && Number(listing.totalPrice) > Number(filters['priceTo'])) return false;
    if (has('areaFrom') && Number(listing.area) < Number(filters['areaFrom'])) return false;
    if (has('areaTo') && Number(listing.area) > Number(filters['areaTo'])) return false;
    if (has('isFurnished') && filters['isFurnished'] === true && !listing.isFurnished) return false;
    if (has('hasElevator') && filters['hasElevator'] === true && !listing.hasElevator) return false;
    if (has('hasWater') && filters['hasWater'] === true && !listing.hasWater) return false;
    if (has('hasElectricity') && filters['hasElectricity'] === true && !listing.hasElectricity) return false;
    return true;
  }

  async checkNewListing(listing: Listing): Promise<void> {
    const savedSearches = await this.savedSearchRepo.find({
      where: { alertEnabled: true },
    });

    const matched = savedSearches.filter((ss) =>
      this.listingMatchesFilters(listing, ss.filters as Record<string, unknown>),
    );

    if (matched.length === 0) return;

    // Bulk-insert alerts (ignore duplicates via allSettled)
    const alerts = matched.map((ss) =>
      this.searchAlertRepo.create({
        savedSearchId: ss.id,
        listingId: listing.id,
        userId: ss.userId,
      }),
    );
    await this.searchAlertRepo.save(alerts).catch(() => null);

    // Notify each matched user (fire-and-forget)
    for (const ss of matched) {
      this.notificationsService
        .createAndSend(
          ss.userId,
          NotificationType.SEARCH_ALERT,
          'New matching listing',
          `A new listing in ${listing.city} matches your saved search${ss.name ? ` "${ss.name}"` : ''}.`,
          NotificationReferenceType.SEARCH_ALERT,
          ss.id,
        )
        .catch(() => null);
    }
  }

  // ─── PROJECTS GEO SEARCH ─────────────────────────────────────────────────────

  buildProjectFilters(dto: GeoSearchProjectsDto): string {
    const parts: string[] = [];
    if (dto.status)    parts.push(`status:${dto.status}`);
    if (dto.priceFrom != null) parts.push(`priceFrom >= ${dto.priceFrom}`);
    if (dto.priceTo != null)   parts.push(`priceTo <= ${dto.priceTo}`);
    return parts.join(' AND ');
  }

  async geoSearchProjects(dto: GeoSearchProjectsDto) {
    const { page = 1, limit = 20, radiusKm = 5 } = dto;
    const filters = this.buildProjectFilters(dto);

    const result = await this.client.searchSingleIndex({
      indexName: this.projectsIndexName,
      searchParams: {
        query: '',
        filters: filters || undefined,
        aroundLatLng: `${dto.latitude},${dto.longitude}`,
        aroundRadius: radiusKm * 1000,
        page: page - 1,
        hitsPerPage: limit,
      },
    });

    return {
      hits: result.hits,
      total: result.nbHits,
      page,
      pages: result.nbPages,
    };
  }
}
