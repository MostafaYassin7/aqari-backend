import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

dotenv.config();
///t
// Used by TypeORM CLI for migration:generate / migration:run / migration:revert.
// DB_HOST in .env is 'postgres' (Docker service name inside docker-compose).
// When running CLI locally outside Docker, override:
//   DB_HOST=localhost npx typeorm-ts-node-commonjs -d src/data-source.ts migration:run
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'aqar_db',
  synchronize: false,
  logging: false,
  entities: ['src/modules/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  migrationsTableName: 'typeorm_migrations',
});

export default AppDataSource;
