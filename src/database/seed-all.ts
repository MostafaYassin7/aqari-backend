/**
 * seed-all.ts — master seed script
 * Run inside Docker: docker-compose exec backend npm run seed
 */
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { algoliasearch } from 'algoliasearch';

import { ListingCategory } from '../modules/listings/entities/listing-category.entity';
import { ListingMedia } from '../modules/listings/entities/listing-media.entity';
import { Listing } from '../modules/listings/entities/listing.entity';
import { PromotionType } from '../modules/promotions/entities/promotion-type.entity';
import { Establishment } from '../modules/users/entities/establishment.entity';
import { Rating } from '../modules/users/entities/rating.entity';
import { User } from '../modules/users/entities/user.entity';

import { ListingStatus } from '../common/enums/listing-status.enum';
import { ListingType } from '../common/enums/listing-type.enum';
import { PropertyType } from '../common/enums/property-type.enum';
import { UsageType } from '../common/enums/usage-type.enum';
import { Facade } from '../common/enums/facade.enum';
import { UserRole } from '../common/enums/user-role.enum';

dotenv.config();

// ─── DataSource ───────────────────────────────────────────────────────────────

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env['DB_HOST'] ?? 'localhost',
  port: Number(process.env['DB_PORT'] ?? 5432),
  username: process.env['DB_USERNAME'],
  password: process.env['DB_PASSWORD'],
  database: process.env['DB_NAME'],
  entities: [User, Establishment, Rating, Listing, ListingCategory, ListingMedia, PromotionType],
  synchronize: false,
});

// ─── 1. CATEGORIES ───────────────────────────────────────────────────────────

const CATEGORIES: Partial<ListingCategory>[] = [
  { name: 'Apartment for Sale',    nameAr: 'شقة للبيع',           propertyType: PropertyType.APARTMENT,         listingType: ListingType.SALE,       sortOrder: 1  },
  { name: 'Apartment for Rent',    nameAr: 'شقة للإيجار',         propertyType: PropertyType.APARTMENT,         listingType: ListingType.RENT_LONG,  sortOrder: 2  },
  { name: 'Apartment Daily Rent',  nameAr: 'شقة إيجار يومي',      propertyType: PropertyType.APARTMENT,         listingType: ListingType.RENT_SHORT, sortOrder: 3  },
  { name: 'Villa for Sale',        nameAr: 'فيلا للبيع',          propertyType: PropertyType.VILLA,             listingType: ListingType.SALE,       sortOrder: 4  },
  { name: 'Villa for Rent',        nameAr: 'فيلا للإيجار',        propertyType: PropertyType.VILLA,             listingType: ListingType.RENT_LONG,  sortOrder: 5  },
  { name: 'Land for Sale',         nameAr: 'أرض للبيع',           propertyType: PropertyType.LAND,              listingType: ListingType.SALE,       sortOrder: 6  },
  { name: 'Land for Rent',         nameAr: 'أرض للإيجار',         propertyType: PropertyType.LAND,              listingType: ListingType.RENT_LONG,  sortOrder: 7  },
  { name: 'Building for Sale',     nameAr: 'عمارة للبيع',         propertyType: PropertyType.BUILDING,          listingType: ListingType.SALE,       sortOrder: 8  },
  { name: 'Office for Rent',       nameAr: 'مكتب للإيجار',        propertyType: PropertyType.COMMERCIAL_OFFICE, listingType: ListingType.RENT_LONG,  sortOrder: 9  },
  { name: 'Shop for Sale',         nameAr: 'محل للبيع',           propertyType: PropertyType.SHOP,              listingType: ListingType.SALE,       sortOrder: 10 },
  { name: 'Shop for Rent',         nameAr: 'محل للإيجار',         propertyType: PropertyType.SHOP,              listingType: ListingType.RENT_LONG,  sortOrder: 11 },
  { name: 'Warehouse for Rent',    nameAr: 'مستودع للإيجار',      propertyType: PropertyType.WAREHOUSE,         listingType: ListingType.RENT_LONG,  sortOrder: 12 },
  { name: 'Chalet Daily Rent',     nameAr: 'شاليه إيجار يومي',    propertyType: PropertyType.CHALET,            listingType: ListingType.RENT_SHORT, sortOrder: 13 },
  { name: 'Rest House for Rent',   nameAr: 'استراحة للإيجار',     propertyType: PropertyType.REST_HOUSE,        listingType: ListingType.RENT_LONG,  sortOrder: 14 },
  { name: 'Rest House Daily Rent', nameAr: 'استراحة إيجار يومي',  propertyType: PropertyType.REST_HOUSE,        listingType: ListingType.RENT_SHORT, sortOrder: 15 },
  { name: 'Event Hall',            nameAr: 'قاعة مناسبات واحتفالات', propertyType: PropertyType.EVENT_HALL,     listingType: ListingType.RENT_SHORT, sortOrder: 16 },
];

// Inserts any categories from CATEGORIES that don't already exist by name,
// so re-running after adding a new entry (e.g. Event Hall) still seeds just
// the new one instead of skipping wholesale because the table is non-empty.
async function seedCategories(ds: DataSource): Promise<Map<string, string>> {
  const repo = ds.getRepository(ListingCategory);
  const existing = await repo.find();
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = CATEGORIES.filter((c) => !existingNames.has(c.name!));

  if (missing.length > 0) {
    await repo.save(repo.create(missing));
    console.log(`✅ Seeded ${missing.length} new listing categories.`);
  } else {
    console.log(`⚠️  All categories already seeded (${existing.length}). Skipping.`);
  }

  const all = await repo.find();
  const map = new Map<string, string>();
  all.forEach((c) => map.set(c.name, c.id));
  return map;
}

// ─── 2. PROMOTION TYPES ──────────────────────────────────────────────────────

const PROMOTION_TYPES: Partial<PromotionType>[] = [
  { name: 'Featured Ad',   nameAr: 'إعلان مميز',        code: 'featured',     description: 'Appear at top of search results',                          descriptionAr: 'يظهر في أعلى نتائج البحث',                                price: '50.00',  durationDays: 7,  sortOrder: 1 },
  { name: 'Golden Ad',     nameAr: 'إعلان ذهبي',        code: 'golden',       description: 'Always visible golden listing, unaffected by search filters', descriptionAr: 'إعلان ذهبي دائم الظهور بغض النظر عن فلاتر البحث',       price: '150.00', durationDays: 30, sortOrder: 2 },
  { name: 'Buyers Alert',  nameAr: 'تنبيه المشترين',    code: 'buyers_alert', description: 'Notify users searching for similar properties',              descriptionAr: 'إشعار المستخدمين الباحثين عن عقارات مشابهة',            price: '75.00',  durationDays: 14, sortOrder: 3 },
  { name: 'Social Media',  nameAr: 'سوشيال ميديا',      code: 'social_media', description: 'Promoted on Aqar social media accounts',                    descriptionAr: 'ترويج على حسابات أقار في وسائل التواصل الاجتماعي',      price: '300.00', durationDays: 7,  sortOrder: 4 },
];

async function seedPromotionTypes(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(PromotionType);
  const count = await repo.count();
  if (count === 0) {
    await repo.save(repo.create(PROMOTION_TYPES));
    console.log(`✅ Seeded ${PROMOTION_TYPES.length} promotion types.`);
  } else {
    console.log(`⚠️  Promotion types already seeded (${count}). Skipping.`);
  }
}

// ─── 3. BUNDLES ──────────────────────────────────────────────────────────────
// NOTE: Bundles module not yet implemented. This step will be wired in
// automatically once the Bundle entity is created in a future slice.

function seedBundles(): void {
  console.log('⏭️  Bundles: module not yet implemented — skipping.');
}

// ─── 4 & 5 & 6. USERS ────────────────────────────────────────────────────────

async function seedUsers(ds: DataSource): Promise<{ admin: User; broker: User; owner: User }> {
  const repo = ds.getRepository(User);

  const upsert = async (phone: string, name: string, role: UserRole): Promise<User> => {
    let user = await repo.findOne({ where: { phone } });
    if (!user) {
      user = await repo.save(repo.create({ phone, name, role, isVerified: true }));
      console.log(`✅ Created ${role} user: ${phone}`);
    } else {
      console.log(`⚠️  User ${phone} already exists. Skipping.`);
    }
    return user;
  };

  const admin  = await upsert('+966500000000', 'Aqar Admin',       UserRole.ADMIN);
  const broker = await upsert('+966500000001', 'Ahmed Al-Rashid',  UserRole.BROKER);
  const owner  = await upsert('+966500000002', 'Sara Al-Ghamdi',   UserRole.OWNER);

  return { admin, broker, owner };
}

// ─── 7. LISTINGS ─────────────────────────────────────────────────────────────

function adNumber(n: number) {
  return `AQ-SEED${String(n).padStart(3, '0')}`;
}

function buildListings(
  catMap: Map<string, string>,
  ownerId: string,
): Partial<Listing>[] {
  const cat = (name: string): string => {
    const id = catMap.get(name);
    if (!id) throw new Error(`Category not found: "${name}". Run seed first.`);
    return id;
  };

  return [
    // ── Riyadh (5) ────────────────────────────────────────────────────────
    {
      adNumber: adNumber(1),
      title: 'Modern Apartment in Al Olaya',
      description: 'Spacious 3-bedroom apartment in the heart of Al Olaya with stunning city views. Recently renovated with high-end finishes.',
      categoryId: cat('Apartment for Sale'),
      propertyType: PropertyType.APARTMENT, listingType: ListingType.SALE,
      totalPrice: '850000', area: '180', pricePerMeter: '4722.22',
      bedrooms: 3, bathrooms: 2, livingRooms: 1, floor: 5, facade: Facade.NORTH,
      isFurnished: true, hasElevator: true, hasKitchen: true, hasWater: true, hasElectricity: true,
      city: 'Riyadh', district: 'Al Olaya', address: 'Al Olaya St, Riyadh',
      latitude: '24.6942', longitude: '46.6849',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(2),
      title: 'Luxury Villa in Al Nakheel',
      description: 'Grand 5-bedroom villa with private pool, landscaped garden, and driver\'s room. Perfect for large families.',
      categoryId: cat('Villa for Sale'),
      propertyType: PropertyType.VILLA, listingType: ListingType.SALE,
      totalPrice: '3500000', area: '600', pricePerMeter: '5833.33',
      bedrooms: 5, bathrooms: 5, livingRooms: 2,
      hasWater: true, hasElectricity: true, hasSewage: true, hasPrivateRoof: true, hasCarEntrance: true,
      isFurnished: false,
      city: 'Riyadh', district: 'Al Nakheel', address: 'Al Nakheel District, Riyadh',
      latitude: '24.7500', longitude: '46.6800',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(3),
      title: 'Apartment for Rent — Al Malqa',
      description: '2-bedroom furnished apartment available immediately. Close to schools and shopping centers.',
      categoryId: cat('Apartment for Rent'),
      propertyType: PropertyType.APARTMENT, listingType: ListingType.RENT_LONG,
      totalPrice: '35000', area: '120', pricePerMeter: '291.67',
      bedrooms: 2, bathrooms: 2, livingRooms: 1, floor: 3,
      isFurnished: true, hasElevator: true, hasKitchen: true, hasWater: true, hasElectricity: true,
      city: 'Riyadh', district: 'Al Malqa', address: 'Al Malqa District, Riyadh',
      latitude: '24.7760', longitude: '46.6380',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(4),
      title: 'Commercial Land — King Fahad Road',
      description: 'Prime commercial land on King Fahad Road. Excellent investment opportunity with road frontage.',
      categoryId: cat('Land for Sale'),
      propertyType: PropertyType.LAND, listingType: ListingType.SALE,
      totalPrice: '12000000', area: '2000', pricePerMeter: '6000', streetWidth: '30',
      hasWater: true, hasElectricity: true,
      city: 'Riyadh', district: 'King Fahad Road', address: 'King Fahad Road, Riyadh',
      latitude: '24.7200', longitude: '46.6750',
      usageType: UsageType.COMMERCIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(5),
      title: 'Villa for Rent — Al Rabwah',
      description: 'Spacious 4-bedroom villa with a private garden in quiet Al Rabwah. Near international schools.',
      categoryId: cat('Villa for Rent'),
      propertyType: PropertyType.VILLA, listingType: ListingType.RENT_LONG,
      totalPrice: '110000', area: '450', pricePerMeter: '244.44',
      bedrooms: 4, bathrooms: 4, livingRooms: 2,
      hasWater: true, hasElectricity: true, hasSewage: true, hasCarEntrance: true, isFurnished: false,
      city: 'Riyadh', district: 'Al Rabwah', address: 'Al Rabwah District, Riyadh',
      latitude: '24.7100', longitude: '46.7100',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },

    // ── Jeddah (5) ────────────────────────────────────────────────────────
    {
      adNumber: adNumber(6),
      title: 'Sea View Apartment — Al Shati',
      description: 'Stunning sea view apartment with 3 bedrooms on the 8th floor. Enjoy Jeddah Corniche right at your doorstep.',
      categoryId: cat('Apartment for Sale'),
      propertyType: PropertyType.APARTMENT, listingType: ListingType.SALE,
      totalPrice: '1200000', area: '210', pricePerMeter: '5714.29',
      bedrooms: 3, bathrooms: 3, livingRooms: 1, floor: 8, facade: Facade.WEST,
      isFurnished: false, hasElevator: true, hasWater: true, hasElectricity: true, hasSewage: true,
      city: 'Jeddah', district: 'Al Shati', address: 'Al Shati District, Jeddah',
      latitude: '21.5970', longitude: '39.1030',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(7),
      title: 'Apartment for Rent — Al Rawdah',
      description: '3-bedroom apartment in a well-maintained building. Walking distance to Al Rawdah park.',
      categoryId: cat('Apartment for Rent'),
      propertyType: PropertyType.APARTMENT, listingType: ListingType.RENT_LONG,
      totalPrice: '55000', area: '160', pricePerMeter: '343.75',
      bedrooms: 3, bathrooms: 2, livingRooms: 1, floor: 2,
      isFurnished: false, hasElevator: true, hasKitchen: true, hasWater: true, hasElectricity: true,
      city: 'Jeddah', district: 'Al Rawdah', address: 'Al Rawdah District, Jeddah',
      latitude: '21.5800', longitude: '39.1500',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(8),
      title: 'Villa for Sale — Al Hamra',
      description: 'Elegant 5-bedroom villa in prestigious Al Hamra district. Private pool and large garden included.',
      categoryId: cat('Villa for Sale'),
      propertyType: PropertyType.VILLA, listingType: ListingType.SALE,
      totalPrice: '4200000', area: '700', pricePerMeter: '6000',
      bedrooms: 5, bathrooms: 5, livingRooms: 3,
      hasWater: true, hasElectricity: true, hasSewage: true, hasCarEntrance: true, isFurnished: false,
      city: 'Jeddah', district: 'Al Hamra', address: 'Al Hamra District, Jeddah',
      latitude: '21.5500', longitude: '39.1700',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(9),
      title: 'Villa for Rent — Al Zahraa',
      description: '4-bedroom villa with private garden. Ideal for families looking for spacious accommodation in north Jeddah.',
      categoryId: cat('Villa for Rent'),
      propertyType: PropertyType.VILLA, listingType: ListingType.RENT_LONG,
      totalPrice: '120000', area: '400', pricePerMeter: '300',
      bedrooms: 4, bathrooms: 4, livingRooms: 2,
      hasWater: true, hasElectricity: true, hasSewage: true, hasCarEntrance: true, isFurnished: false,
      city: 'Jeddah', district: 'Al Zahraa', address: 'Al Zahraa District, Jeddah',
      latitude: '21.6350', longitude: '39.1100',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(10),
      title: 'Apartment for Sale — Al Andalus',
      description: 'Brand new 2-bedroom apartment near major shopping malls. Gym and swimming pool in the compound.',
      categoryId: cat('Apartment for Sale'),
      propertyType: PropertyType.APARTMENT, listingType: ListingType.SALE,
      totalPrice: '680000', area: '145', pricePerMeter: '4689.66',
      bedrooms: 2, bathrooms: 2, livingRooms: 1, floor: 4,
      isFurnished: false, hasElevator: true, hasKitchen: true, hasWater: true, hasElectricity: true,
      city: 'Jeddah', district: 'Al Andalus', address: 'Al Andalus District, Jeddah',
      latitude: '21.5600', longitude: '39.1600',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },

    // ── Dammam (5) ────────────────────────────────────────────────────────
    {
      adNumber: adNumber(11),
      title: 'Apartment for Sale — Al Shulah',
      description: 'Brand new 2-bedroom apartment in a modern compound. Gym, pool and 24/7 security included.',
      categoryId: cat('Apartment for Sale'),
      propertyType: PropertyType.APARTMENT, listingType: ListingType.SALE,
      totalPrice: '420000', area: '130', pricePerMeter: '3230.77',
      bedrooms: 2, bathrooms: 2, livingRooms: 1, floor: 2,
      isFurnished: false, hasElevator: true, hasKitchen: true, hasWater: true, hasElectricity: true,
      city: 'Dammam', district: 'Al Shulah', address: 'Al Shulah District, Dammam',
      latitude: '26.4200', longitude: '50.0900',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(12),
      title: 'Apartment for Rent — Al Faisaliyah',
      description: '3-bedroom apartment on a high floor with Gulf views. Available from next month.',
      categoryId: cat('Apartment for Rent'),
      propertyType: PropertyType.APARTMENT, listingType: ListingType.RENT_LONG,
      totalPrice: '42000', area: '150', pricePerMeter: '280',
      bedrooms: 3, bathrooms: 2, livingRooms: 1, floor: 7,
      isFurnished: true, hasElevator: true, hasWater: true, hasElectricity: true,
      city: 'Dammam', district: 'Al Faisaliyah', address: 'Al Faisaliyah District, Dammam',
      latitude: '26.4350', longitude: '50.1050',
      usageType: UsageType.RESIDENTIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(13),
      title: 'Commercial Shop for Rent — Al Muraikabat',
      description: 'Ground floor commercial shop on a busy street. Ideal for retail or service businesses.',
      categoryId: cat('Shop for Rent'),
      propertyType: PropertyType.SHOP, listingType: ListingType.RENT_LONG,
      totalPrice: '60000', area: '80', pricePerMeter: '750',
      hasWater: true, hasElectricity: true,
      city: 'Dammam', district: 'Al Muraikabat', address: 'Al Muraikabat, Dammam',
      latitude: '26.4280', longitude: '50.1120',
      usageType: UsageType.COMMERCIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(14),
      title: 'Office Space for Rent — Al Rakah',
      description: 'Modern office space in a commercial tower. Flexible partitioning, dedicated parking.',
      categoryId: cat('Office for Rent'),
      propertyType: PropertyType.COMMERCIAL_OFFICE, listingType: ListingType.RENT_LONG,
      totalPrice: '90000', area: '200', pricePerMeter: '450',
      hasElevator: true, hasWater: true, hasElectricity: true,
      city: 'Dammam', district: 'Al Rakah', address: 'Al Rakah District, Dammam',
      latitude: '26.4450', longitude: '50.1000',
      usageType: UsageType.COMMERCIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
    {
      adNumber: adNumber(15),
      title: 'Warehouse for Rent — Industrial Area',
      description: 'Large warehouse with heavy-duty flooring, loading dock, and 24/7 access. Close to King Fahad Causeway.',
      categoryId: cat('Warehouse for Rent'),
      propertyType: PropertyType.WAREHOUSE, listingType: ListingType.RENT_LONG,
      totalPrice: '120000', area: '1000', pricePerMeter: '120',
      hasWater: true, hasElectricity: true, hasCarEntrance: true,
      city: 'Dammam', district: 'Industrial Area', address: 'Industrial Area, Dammam',
      latitude: '26.3900', longitude: '50.0800',
      usageType: UsageType.COMMERCIAL, status: ListingStatus.PUBLISHED, ownerId,
    },
  ];
}

async function seedListings(
  ds: DataSource,
  catMap: Map<string, string>,
  owner: User,
): Promise<Listing[]> {
  const repo = ds.getRepository(Listing);
  const existing = await repo.count({ where: { adNumber: adNumber(1) } });
  if (existing > 0) {
    console.log('⚠️  Listings already seeded. Skipping.');
    return [];
  }
  const data = buildListings(catMap, owner.id);
  const saved = await repo.save(repo.create(data as Listing[]));
  console.log(`✅ Seeded ${saved.length} listings to PostgreSQL.`);
  return saved;
}

// ─── ALGOLIA SYNC ─────────────────────────────────────────────────────────────

async function syncToAlgolia(listings: Listing[], catMap: Map<string, string>, owner: User): Promise<void> {
  const appId  = process.env['ALGOLIA_APP_ID'];
  const apiKey = process.env['ALGOLIA_API_KEY'];
  const index  = process.env['ALGOLIA_LISTINGS_INDEX'] ?? 'aqar_listings';

  if (!appId || appId === 'placeholder') {
    console.log('⚠️  Algolia credentials not set — skipping Algolia sync.');
    return;
  }

  const idToName = new Map<string, string>();
  catMap.forEach((id, name) => idToName.set(id, name));

  const client  = algoliasearch(appId, apiKey!);
  const objects = listings.map((l) => ({
    objectID: l.id,
    title: l.title,
    description: l.description,
    status: l.status,
    adNumber: l.adNumber,
    propertyType: l.propertyType,
    listingType: l.listingType,
    categoryName: idToName.get(l.categoryId) ?? null,
    totalPrice: Number(l.totalPrice),
    pricePerMeter: l.pricePerMeter ? Number(l.pricePerMeter) : null,
    area: Number(l.area),
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    city: l.city,
    district: l.district,
    _geoloc: { lat: Number(l.latitude), lng: Number(l.longitude) },
    isFurnished: l.isFurnished,
    hasElevator: l.hasElevator,
    hasWater: l.hasWater,
    hasElectricity: l.hasElectricity,
    isPromoted: l.isPromoted,
    isGolden: l.isGolden,
    coverPhoto: l.coverPhoto,
    ownerName: owner.name,
    ownerPhoto: owner.profilePhoto,
    createdAt: Math.floor(new Date(l.createdAt).getTime() / 1000),
  }));

  await client.saveObjects({ indexName: index, objects });
  console.log(`✅ Synced ${objects.length} listings to Algolia index "${index}".`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 Starting Aqar seed...\n');
  await dataSource.initialize();

  const catMap = await seedCategories(dataSource);      // step 1
  await seedPromotionTypes(dataSource);                 // step 2
  seedBundles();                                         // step 3 (stub)
  const { broker } = await seedUsers(dataSource);       // steps 4, 5, 6
  const listings = await seedListings(dataSource, catMap, broker); // step 7

  if (listings.length > 0) {
    await syncToAlgolia(listings, catMap, broker);
  }

  await dataSource.destroy();
  console.log('\n✅ All seeds complete.\n');
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
