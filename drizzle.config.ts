import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/notification/infrastructure/persistence/*.table.ts',
  out: './drizzle',
});
