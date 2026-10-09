import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/notification/adapter/driven/persistence/**/*.table.ts',
  out: './drizzle',
});
