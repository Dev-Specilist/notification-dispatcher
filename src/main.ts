import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from '@/bootstrap/api.module';
import { ApiDocumentationBootstrap } from '@/bootstrap/server/api-documentation.bootstrap';
import { ServerBootstrap } from '@/bootstrap/server/server.bootstrap';

void ServerBootstrap.run(async (): Promise<void> => {
  const app: INestApplication = await NestFactory.create(ApiModule.forRoot(), {
    bufferLogs: true,
    abortOnError: false,
  });
  ApiDocumentationBootstrap.setup(app);
  await ServerBootstrap.start(app);
});
