import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
    url: env('DATABASE_URL'),
  },
});
