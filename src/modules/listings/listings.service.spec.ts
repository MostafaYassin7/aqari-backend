/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { ListingType } from '../../common/enums/listing-type.enum';
import { PropertyType } from '../../common/enums/property-type.enum';

jest.mock('../media/media.service', () => ({
  MediaService: class MediaService {},
}));

import { CreateListingDto } from './dto/create-listing.dto';
import { Listing } from './entities/listing.entity';
import { ListingsService } from './listings.service';

const baseDto: CreateListingDto = {
  title: 'Test listing',
  categoryId: 'category-1',
  propertyType: PropertyType.APARTMENT,
  listingType: ListingType.SALE,
  totalPrice: 100,
  area: 10,
  city: 'Riyadh',
  latitude: 24.7,
  longitude: 46.6,
  advertiserType: 'owner',
};

describe('ListingsService category-field normalization', () => {
  const created: Record<string, unknown>[] = [];
  const listingsRepo = {
    create: jest.fn((value) => {
      created.push(value);
      return value;
    }),
    save: jest.fn(async (value) => ({
      id: `listing-${created.length}`,
      ...value,
    })),
    findOneOrFail: jest.fn(async ({ where }) => ({ id: where.id }) as Listing),
  };
  const categoriesRepo = { findOne: jest.fn() };
  const service = new ListingsService(
    listingsRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findOne: jest.fn() } as never,
    categoriesRepo as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    created.length = 0;
    jest.clearAllMocks();
    listingsRepo.create.mockImplementation((value) => {
      created.push(value);
      return value;
    });
    listingsRepo.save.mockImplementation(async (value) => ({
      id: `listing-${created.length}`,
      ...value,
    }));
    listingsRepo.findOneOrFail.mockImplementation(
      async ({ where }) => ({ id: where.id }) as Listing,
    );
  });

  async function create(dto: CreateListingDto) {
    categoriesRepo.findOne.mockResolvedValue({
      id: dto.categoryId,
      propertyType: dto.propertyType,
      listingType: dto.listingType,
    });
    await service.createListing('owner-1', dto);
    return created[0];
  }

  it('retains only event-hall fields for event halls', async () => {
    const value = await create({
      ...baseDto,
      propertyType: PropertyType.EVENT_HALL,
      listingType: ListingType.RENT_SHORT,
      maxGuests: 100,
      pricePerHalfDay: 500,
      includedServices: ['parking'],
      checkInTime: '14:00',
      checkOutTime: '11:00',
      minNights: 4,
    });
    expect(value).toMatchObject({
      maxGuests: 100,
      pricePerHalfDay: '500',
      includedServices: ['parking'],
      checkInTime: null,
      checkOutTime: null,
      minNights: null,
      status: ListingStatus.DRAFT,
    });
  });

  it('retains only daily-rental fields for daily rentals', async () => {
    const value = await create({
      ...baseDto,
      listingType: ListingType.RENT_SHORT,
      maxGuests: 4,
      checkInTime: '14:00',
      checkOutTime: '11:00',
      minNights: 2,
      pricePerHalfDay: 500,
      includedServices: ['parking'],
    });
    expect(value).toMatchObject({
      maxGuests: 4,
      checkInTime: '14:00',
      checkOutTime: '11:00',
      minNights: 2,
      pricePerHalfDay: null,
      includedServices: null,
    });
  });

  it('clears all bookable-only fields for other listings', async () => {
    const value = await create({
      ...baseDto,
      maxGuests: 4,
      checkInTime: '14:00',
      checkOutTime: '11:00',
      minNights: 2,
      pricePerHalfDay: 500,
      includedServices: ['parking'],
    });
    expect(value).toMatchObject({
      maxGuests: null,
      checkInTime: null,
      checkOutTime: null,
      minNights: null,
      pricePerHalfDay: null,
      includedServices: null,
    });
  });
});
