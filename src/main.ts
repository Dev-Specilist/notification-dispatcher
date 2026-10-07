import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from '@/bootstrap/api.module';
import { ServerBootstrap } from '@/bootstrap/server/server.bootstrap';

void ServerBootstrap.run(async (): Promise<void> => {
  const app: INestApplication = await NestFactory.create(ApiModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  await ServerBootstrap.start(app);
});
