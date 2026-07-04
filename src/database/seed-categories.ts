import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { ListingCategory } from '../modules/listings/entities/listing-category.entity';
import { ListingType } from '../common/enums/listing-type.enum';
import { PropertyType } from '../common/enums/property-type.enum';

dotenv.config();

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env['DB_HOST'],
  port: Number(process.env['DB_PORT']),
  username: process.env['DB_USERNAME'],
  password: process.env['DB_PASSWORD'],
  database: process.env['DB_NAME'],
  entities: [ListingCategory],
  synchronize: false,
});

const CATEGORIES: Partial<ListingCategory>[] = [
  // Apartments
  { name: 'Apartment for Sale',        nameAr: 'شقة للبيع',             propertyType: PropertyType.APARTMENT,        listingType: ListingType.SALE,       sortOrder: 1  },
  { name: 'Apartment for Rent',        nameAr: 'شقة للإيجار',           propertyType: PropertyType.APARTMENT,        listingType: ListingType.RENT_LONG,  sortOrder: 2  },
  { name: 'Apartment Daily Rent',      nameAr: 'شقة إيجار يومي',        propertyType: PropertyType.APARTMENT,        listingType: ListingType.RENT_SHORT, sortOrder: 3  },
  // Villas
  { name: 'Villa for Sale',            nameAr: 'فيلا للبيع',            propertyType: PropertyType.VILLA,            listingType: ListingType.SALE,       sortOrder: 4  },
  { name: 'Villa for Rent',            nameAr: 'فيلا للإيجار',          propertyType: PropertyType.VILLA,            listingType: ListingType.RENT_LONG,  sortOrder: 5  },
  { name: 'Villa Daily Rent',          nameAr: 'فيلا إيجار يومي',       propertyType: PropertyType.VILLA,            listingType: ListingType.RENT_SHORT, sortOrder: 6  },
  // Floors
  { name: 'Floor for Sale',            nameAr: 'دور للبيع',             propertyType: PropertyType.FLOOR,            listingType: ListingType.SALE,       sortOrder: 7  },
  { name: 'Floor for Rent',            nameAr: 'دور للإيجار',           propertyType: PropertyType.FLOOR,            listingType: ListingType.RENT_LONG,  sortOrder: 8  },
  // Land
  { name: 'Land for Sale',             nameAr: 'أرض للبيع',             propertyType: PropertyType.LAND,             listingType: ListingType.SALE,       sortOrder: 9  },
  { name: 'Land for Rent',             nameAr: 'أرض للإيجار',           propertyType: PropertyType.LAND,             listingType: ListingType.RENT_LONG,  sortOrder: 10 },
  // Buildings
  { name: 'Building for Sale',         nameAr: 'عمارة للبيع',           propertyType: PropertyType.BUILDING,         listingType: ListingType.SALE,       sortOrder: 11 },
  { name: 'Building for Rent',         nameAr: 'عمارة للإيجار',         propertyType: PropertyType.BUILDING,         listingType: ListingType.RENT_LONG,  sortOrder: 12 },
  // Shops
  { name: 'Shop for Sale',             nameAr: 'محل للبيع',             propertyType: PropertyType.SHOP,             listingType: ListingType.SALE,       sortOrder: 13 },
  { name: 'Shop for Rent',             nameAr: 'محل للإيجار',           propertyType: PropertyType.SHOP,             listingType: ListingType.RENT_LONG,  sortOrder: 14 },
  // Houses
  { name: 'House for Sale',            nameAr: 'بيت للبيع',             propertyType: PropertyType.HOUSE,            listingType: ListingType.SALE,       sortOrder: 15 },
  { name: 'House for Rent',            nameAr: 'بيت للإيجار',           propertyType: PropertyType.HOUSE,            listingType: ListingType.RENT_LONG,  sortOrder: 16 },
  // Rest Houses
  { name: 'Rest House for Sale',       nameAr: 'استراحة للبيع',         propertyType: PropertyType.REST_HOUSE,       listingType: ListingType.SALE,       sortOrder: 17 },
  { name: 'Rest House for Rent',       nameAr: 'استراحة للإيجار',       propertyType: PropertyType.REST_HOUSE,       listingType: ListingType.RENT_LONG,  sortOrder: 18 },
  { name: 'Rest House Daily Rent',     nameAr: 'استراحة إيجار يومي',    propertyType: PropertyType.REST_HOUSE,       listingType: ListingType.RENT_SHORT, sortOrder: 19 },
  // Farms
  { name: 'Farm for Sale',             nameAr: 'مزرعة للبيع',           propertyType: PropertyType.FARM,             listingType: ListingType.SALE,       sortOrder: 20 },
  { name: 'Farm for Rent',             nameAr: 'مزرعة للإيجار',         propertyType: PropertyType.FARM,             listingType: ListingType.RENT_LONG,  sortOrder: 21 },
  // Commercial Offices
  { name: 'Office for Sale',           nameAr: 'مكتب للبيع',            propertyType: PropertyType.COMMERCIAL_OFFICE, listingType: ListingType.SALE,      sortOrder: 22 },
  { name: 'Office for Rent',           nameAr: 'مكتب للإيجار',          propertyType: PropertyType.COMMERCIAL_OFFICE, listingType: ListingType.RENT_LONG, sortOrder: 23 },
  // Chalets
  { name: 'Chalet for Sale',           nameAr: 'شاليه للبيع',           propertyType: PropertyType.CHALET,           listingType: ListingType.SALE,       sortOrder: 24 },
  { name: 'Chalet Daily Rent',         nameAr: 'شاليه إيجار يومي',      propertyType: PropertyType.CHALET,           listingType: ListingType.RENT_SHORT, sortOrder: 25 },
  // Warehouses
  { name: 'Warehouse for Sale',        nameAr: 'مستودع للبيع',          propertyType: PropertyType.WAREHOUSE,        listingType: ListingType.SALE,       sortOrder: 26 },
  { name: 'Warehouse for Rent',        nameAr: 'مستودع للإيجار',        propertyType: PropertyType.WAREHOUSE,        listingType: ListingType.RENT_LONG,  sortOrder: 27 },
  // Camps
  { name: 'Camp for Sale',             nameAr: 'مخيم للبيع',            propertyType: PropertyType.CAMP,             listingType: ListingType.SALE,       sortOrder: 28 },
  { name: 'Camp for Rent',             nameAr: 'مخيم للإيجار',          propertyType: PropertyType.CAMP,             listingType: ListingType.RENT_LONG,  sortOrder: 29 },
  // Event Halls
  { name: 'Event Hall',                nameAr: 'قاعة مناسبات واحتفالات', propertyType: PropertyType.EVENT_HALL,      listingType: ListingType.RENT_SHORT, sortOrder: 30 },
];

// Inserts any categories from CATEGORIES that don't already exist by name,
// so re-running after adding a new entry still seeds just the new one
// instead of skipping wholesale because the table is non-empty.
async function seed() {
  await dataSource.initialize();
  const repo = dataSource.getRepository(ListingCategory);

  const existing = await repo.find();
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = CATEGORIES.filter((c) => !existingNames.has(c.name!));

  if (missing.length === 0) {
    console.log(`⚠️  All categories already seeded (${existing.length} records). Skipping.`);
    await dataSource.destroy();
    return;
  }

  await repo.save(repo.create(missing));
  console.log(`✅ Seeded ${missing.length} new listing categories.`);
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
