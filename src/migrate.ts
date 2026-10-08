import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MigrateModule } from '@/bootstrap/migrate.module';
import { ServerBootstrap } from '@/bootstrap/server/server.bootstrap';
import { DatabaseMigrator } from '@/shared/database/database-migrator.service';
import { AppLogger } from '@/shared/logging/app.logger';

void ServerBootstrap.run(async (): Promise<void> => {
  const app: INestApplicationContext = await NestFactory.createApplicationContext(MigrateModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(AppLogger));
  await app.get(DatabaseMigrator).migrate();
  await app.close();
});
