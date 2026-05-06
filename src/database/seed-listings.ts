import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { algoliasearch } from 'algoliasearch';
import { ListingCategory } from '../modules/listings/entities/listing-category.entity';
import { ListingMedia } from '../modules/listings/entities/listing-media.entity';
import { Listing } from '../modules/listings/entities/listing.entity';
import { User } from '../modules/users/entities/user.entity';
import { ListingStatus } from '../common/enums/listing-status.enum';
import { ListingType } from '../common/enums/listing-type.enum';
import { PropertyType } from '../common/enums/property-type.enum';
import { UsageType } from '../common/enums/usage-type.enum';
import { Facade } from '../common/enums/facade.enum';
import { UserRole } from '../common/enums/user-role.enum';

dotenv.config();

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env['DB_HOST'],
  port: Number(process.env['DB_PORT']),
  username: process.env['DB_USERNAME'],
  password: process.env['DB_PASSWORD'],
  database: process.env['DB_NAME'],
  entities: [Listing, ListingCategory, ListingMedia, User],
  synchronize: false,
});

function adNumber(n: number) {
  return `AQ-SEED${String(n).padStart(3, '0')}`;
}

async function seed() {
  await dataSource.initialize();

  const listingsRepo = dataSource.getRepository(Listing);
  const categoriesRepo = dataSource.getRepository(ListingCategory);
  const usersRepo = dataSource.getRepository(User);

  // Check if already seeded
  const existing = await listingsRepo.count({ where: { adNumber: adNumber(1) } });
  if (existing > 0) {
    console.log('⚠️  Listings already seeded. Skipping.');
    await dataSource.destroy();
    return;
  }

  // Create a seed owner user if none exists
  let owner = await usersRepo.findOne({ where: { phone: '+966500000001' } });
  if (!owner) {
    owner = await usersRepo.save(
      usersRepo.create({
        phone: '+966500000001',
        name: 'Ahmed Al-Rashid',
        role: UserRole.OWNER,
        isVerified: true,
      }),
    );
    console.log('👤 Created seed owner:', owner.id);
  }

  // Load categories by name
  const cats = await categoriesRepo.find();
  const cat = (name: string) => {
    const c = cats.find(c => c.name === name);
    if (!c) throw new Error(`Category not found: ${name}. Run seed:categories first.`);
    return c;
  };

  const listings: Partial<Listing>[] = [
    // ── Riyadh ────────────────────────────────────────────────────────────────
    {
      adNumber: adNumber(1),
      title: 'Modern Apartment in Al Olaya',
      description: 'Spacious 3-bedroom apartment in the heart of Al Olaya with stunning city views. Recently renovated with high-end finishes.',
      categoryId: cat('Apartment for Sale').id,
      propertyType: PropertyType.APARTMENT,
      listingType: ListingType.SALE,
      totalPrice: '850000',
      area: '180',
      pricePerMeter: '4722.22',
      bedrooms: 3, bathrooms: 2, livingRooms: 1,
      floor: 5, facade: Facade.NORTH,
      isFurnished: true, hasElevator: true, hasKitchen: true,
      hasWater: true, hasElectricity: true,
      city: 'Riyadh', district: 'Al Olaya',
      latitude: '24.6942', longitude: '46.6849',
      address: 'Al Olaya St, Riyadh',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(2),
      title: 'Luxury Villa in Al Nakheel',
      description: 'Grand 5-bedroom villa with private pool, landscaped garden, and driver\'s room. Perfect for large families.',
      categoryId: cat('Villa for Sale').id,
      propertyType: PropertyType.VILLA,
      listingType: ListingType.SALE,
      totalPrice: '3500000',
      area: '600',
      pricePerMeter: '5833.33',
      bedrooms: 5, bathrooms: 5, livingRooms: 2,
      hasWater: true, hasElectricity: true, hasSewage: true,
      hasPrivateRoof: true, hasCarEntrance: true, hasElevator: false,
      isFurnished: false,
      city: 'Riyadh', district: 'Al Nakheel',
      latitude: '24.7500', longitude: '46.6800',
      address: 'Al Nakheel District, Riyadh',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(3),
      title: 'Apartment for Rent — Al Malqa',
      description: '2-bedroom furnished apartment available immediately. Close to schools and shopping centers.',
      categoryId: cat('Apartment for Rent').id,
      propertyType: PropertyType.APARTMENT,
      listingType: ListingType.RENT_LONG,
      totalPrice: '35000',
      area: '120',
      pricePerMeter: '291.67',
      bedrooms: 2, bathrooms: 2, livingRooms: 1,
      floor: 3, hasElevator: true,
      isFurnished: true, hasKitchen: true,
      hasWater: true, hasElectricity: true,
      city: 'Riyadh', district: 'Al Malqa',
      latitude: '24.7760', longitude: '46.6380',
      address: 'Al Malqa District, Riyadh',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(4),
      title: 'Commercial Land — King Fahad Road',
      description: 'Prime commercial land on King Fahad Road. Excellent investment opportunity with road frontage.',
      categoryId: cat('Land for Sale').id,
      propertyType: PropertyType.LAND,
      listingType: ListingType.SALE,
      totalPrice: '12000000',
      area: '2000',
      pricePerMeter: '6000',
      streetWidth: '30',
      hasWater: true, hasElectricity: true,
      city: 'Riyadh', district: 'King Fahad Road',
      latitude: '24.7200', longitude: '46.6750',
      address: 'King Fahad Road, Riyadh',
      usageType: UsageType.COMMERCIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(5),
      title: 'Daily Rent Apartment — Diplomatic Quarter',
      description: 'Fully furnished studio apartment for daily or weekly rent. All utilities included.',
      categoryId: cat('Apartment Daily Rent').id,
      propertyType: PropertyType.APARTMENT,
      listingType: ListingType.RENT_SHORT,
      totalPrice: '350',
      area: '65',
      pricePerMeter: '5.38',
      bedrooms: 1, bathrooms: 1,
      isFurnished: true, hasKitchen: true, hasElevator: true,
      hasWater: true, hasElectricity: true,
      city: 'Riyadh', district: 'Diplomatic Quarter',
      latitude: '24.6820', longitude: '46.6350',
      address: 'Diplomatic Quarter, Riyadh',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    // ── Jeddah ────────────────────────────────────────────────────────────────
    {
      adNumber: adNumber(6),
      title: 'Sea View Apartment — Al Shati',
      description: 'Stunning sea view apartment with 3 bedrooms on the 8th floor. Enjoy Jeddah Corniche right at your doorstep.',
      categoryId: cat('Apartment for Sale').id,
      propertyType: PropertyType.APARTMENT,
      listingType: ListingType.SALE,
      totalPrice: '1200000',
      area: '210',
      pricePerMeter: '5714.29',
      bedrooms: 3, bathrooms: 3, livingRooms: 1,
      floor: 8, facade: Facade.WEST,
      isFurnished: false, hasElevator: true,
      hasWater: true, hasElectricity: true, hasSewage: true,
      city: 'Jeddah', district: 'Al Shati',
      latitude: '21.5970', longitude: '39.1030',
      address: 'Al Shati District, Jeddah',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(7),
      title: 'Villa for Rent — Al Zahraa',
      description: '4-bedroom villa with private garden. Ideal for families looking for spacious accommodation in north Jeddah.',
      categoryId: cat('Villa for Rent').id,
      propertyType: PropertyType.VILLA,
      listingType: ListingType.RENT_LONG,
      totalPrice: '120000',
      area: '400',
      pricePerMeter: '300',
      bedrooms: 4, bathrooms: 4, livingRooms: 2,
      hasWater: true, hasElectricity: true, hasSewage: true,
      hasCarEntrance: true, isFurnished: false,
      city: 'Jeddah', district: 'Al Zahraa',
      latitude: '21.6350', longitude: '39.1100',
      address: 'Al Zahraa District, Jeddah',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(8),
      title: 'Office Space — Al Andalus',
      description: 'Modern office space in a prime commercial building. Suitable for law firms, consulting offices, and clinics.',
      categoryId: cat('Office for Rent').id,
      propertyType: PropertyType.COMMERCIAL_OFFICE,
      listingType: ListingType.RENT_LONG,
      totalPrice: '80000',
      area: '150',
      pricePerMeter: '533.33',
      hasElevator: true, hasWater: true, hasElectricity: true,
      city: 'Jeddah', district: 'Al Andalus',
      latitude: '21.5600', longitude: '39.1600',
      address: 'Al Andalus District, Jeddah',
      usageType: UsageType.COMMERCIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    // ── Dammam ────────────────────────────────────────────────────────────────
    {
      adNumber: adNumber(9),
      title: 'Residential Land — Al Faisaliyah',
      description: 'Corner residential land ready for construction. All utilities connected to the street.',
      categoryId: cat('Land for Sale').id,
      propertyType: PropertyType.LAND,
      listingType: ListingType.SALE,
      totalPrice: '750000',
      area: '500',
      pricePerMeter: '1500',
      streetWidth: '15',
      hasWater: true, hasElectricity: true, hasSewage: true,
      city: 'Dammam', district: 'Al Faisaliyah',
      latitude: '26.4350', longitude: '50.1050',
      address: 'Al Faisaliyah, Dammam',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(10),
      title: 'Apartment for Sale — Al Shulah',
      description: 'Brand new 2-bedroom apartment in a modern compound. Gym, pool and 24/7 security included.',
      categoryId: cat('Apartment for Sale').id,
      propertyType: PropertyType.APARTMENT,
      listingType: ListingType.SALE,
      totalPrice: '420000',
      area: '130',
      pricePerMeter: '3230.77',
      bedrooms: 2, bathrooms: 2, livingRooms: 1,
      floor: 2, hasElevator: true,
      isFurnished: false, hasKitchen: true,
      hasWater: true, hasElectricity: true,
      city: 'Dammam', district: 'Al Shulah',
      latitude: '26.4200', longitude: '50.0900',
      address: 'Al Shulah District, Dammam',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    // ── Khobar ────────────────────────────────────────────────────────────────
    {
      adNumber: adNumber(11),
      title: 'Chalet Daily Rent — Half Moon Bay',
      description: 'Beachfront chalet perfect for weekend getaways. Private beach access, BBQ area, and full kitchen.',
      categoryId: cat('Chalet Daily Rent').id,
      propertyType: PropertyType.CHALET,
      listingType: ListingType.RENT_SHORT,
      totalPrice: '1500',
      area: '200',
      pricePerMeter: '7.50',
      bedrooms: 3, bathrooms: 2,
      isFurnished: true, hasKitchen: true,
      hasWater: true, hasElectricity: true,
      city: 'Khobar', district: 'Half Moon Bay',
      latitude: '26.2200', longitude: '50.2000',
      address: 'Half Moon Bay, Khobar',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    {
      adNumber: adNumber(12),
      title: 'Building for Sale — Al Aqrabiyah',
      description: 'Income-generating residential building with 8 apartments. Fully rented with long-term tenants.',
      categoryId: cat('Building for Sale').id,
      propertyType: PropertyType.BUILDING,
      listingType: ListingType.SALE,
      totalPrice: '5500000',
      area: '800',
      pricePerMeter: '6875',
      hasWater: true, hasElectricity: true, hasSewage: true,
      hasElevator: true, hasCarEntrance: true,
      city: 'Khobar', district: 'Al Aqrabiyah',
      latitude: '26.2800', longitude: '50.2100',
      address: 'Al Aqrabiyah, Khobar',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    // ── Mecca ─────────────────────────────────────────────────────────────────
    {
      adNumber: adNumber(13),
      title: 'Apartment near Al Haram — Al Aziziyah',
      description: '2-bedroom apartment 800m from Al Haram. Ideal for seasonal rental and Umrah visitors.',
      categoryId: cat('Apartment for Sale').id,
      propertyType: PropertyType.APARTMENT,
      listingType: ListingType.SALE,
      totalPrice: '950000',
      area: '110',
      pricePerMeter: '8636.36',
      bedrooms: 2, bathrooms: 2,
      floor: 4, hasElevator: true,
      isFurnished: true,
      hasWater: true, hasElectricity: true,
      city: 'Mecca', district: 'Al Aziziyah',
      latitude: '21.3760', longitude: '39.8530',
      address: 'Al Aziziyah, Mecca',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    // ── Medina ────────────────────────────────────────────────────────────────
    {
      adNumber: adNumber(14),
      title: 'Villa for Sale — Al Ranuna',
      description: 'Well-maintained villa with 5 bedrooms, large yard and modern kitchen. Walking distance to Al Masjid Al Nabawi.',
      categoryId: cat('Villa for Sale').id,
      propertyType: PropertyType.VILLA,
      listingType: ListingType.SALE,
      totalPrice: '2100000',
      area: '450',
      pricePerMeter: '4666.67',
      bedrooms: 5, bathrooms: 4, livingRooms: 2,
      hasWater: true, hasElectricity: true, hasSewage: true,
      hasCarEntrance: true, hasPrivateRoof: true,
      city: 'Medina', district: 'Al Ranuna',
      latitude: '24.4680', longitude: '39.6110',
      address: 'Al Ranuna District, Medina',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
    // ── Abha ──────────────────────────────────────────────────────────────────
    {
      adNumber: adNumber(15),
      title: 'Rest House for Rent — Al Souda',
      description: 'Cozy mountain rest house surrounded by greenery. Perfect for family vacations in Abha\'s cool weather.',
      categoryId: cat('Rest House Daily Rent').id,
      propertyType: PropertyType.REST_HOUSE,
      listingType: ListingType.RENT_SHORT,
      totalPrice: '800',
      area: '250',
      pricePerMeter: '3.20',
      bedrooms: 4, bathrooms: 3,
      isFurnished: true, hasKitchen: true,
      hasWater: true, hasElectricity: true,
      city: 'Abha', district: 'Al Souda',
      latitude: '18.2200', longitude: '42.5050',
      address: 'Al Souda, Abha',
      usageType: UsageType.RESIDENTIAL,
      status: ListingStatus.PUBLISHED,
      ownerId: owner.id,
    },
  ];

  // Save to PostgreSQL
  const saved = await listingsRepo.save(listingsRepo.create(listings as Listing[]));
  console.log(`✅ Seeded ${saved.length} listings to PostgreSQL.`);

  // Sync to Algolia
  const algoliaAppId = process.env['ALGOLIA_APP_ID'];
  const algoliaApiKey = process.env['ALGOLIA_API_KEY'];
  const algoliaIndex = process.env['ALGOLIA_LISTINGS_INDEX'] ?? 'aqar_listings';

  if (!algoliaAppId || algoliaAppId === 'placeholder') {
    console.log('⚠️  Algolia credentials not set — skipping Algolia sync.');
    await dataSource.destroy();
    return;
  }

  const client = algoliasearch(algoliaAppId, algoliaApiKey!);
  const objects = saved.map((l) => {
    const cat = cats.find(c => c.id === l.categoryId);
    return {
      objectID: l.id,
      title: l.title,
      description: l.description,
      status: l.status,
      adNumber: l.adNumber,
      propertyType: l.propertyType,
      listingType: l.listingType,
      categoryName: cat?.name ?? null,
      totalPrice: Number(l.totalPrice),
      pricePerMeter: l.pricePerMeter ? Number(l.pricePerMeter) : null,
      area: Number(l.area),
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      livingRooms: l.livingRooms,
      city: l.city,
      district: l.district,
      _geoloc: { lat: Number(l.latitude), lng: Number(l.longitude) },
      isFurnished: l.isFurnished,
      hasElevator: l.hasElevator,
      hasWater: l.hasWater,
      hasElectricity: l.hasElectricity,
      coverPhoto: l.coverPhoto,
      ownerName: owner!.name,
      ownerPhoto: owner!.profilePhoto,
      createdAt: Math.floor(new Date(l.createdAt).getTime() / 1000),
    };
  });

  await client.saveObjects({ indexName: algoliaIndex, objects });
  console.log(`✅ Synced ${objects.length} listings to Algolia index "${algoliaIndex}".`);

  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
