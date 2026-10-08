import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

type DocumentConfig = Omit<OpenAPIObject, 'paths'>;

export class ApiDocumentationBootstrap {
  private static readonly UI_PATH: string = 'docs';

  private static readonly JSON_PATH: string = 'docs-json';

  static setup(app: INestApplication): void {
    const documentConfig: DocumentConfig = new DocumentBuilder()
      .setTitle('Notification Dispatcher API')
      .setDescription('알림 생성 · 조회 · 발송 시작 · 취소')
      .setVersion('1.0.0')
      .build();
    SwaggerModule.setup(
      ApiDocumentationBootstrap.UI_PATH,
      app,
      (): OpenAPIObject => SwaggerModule.createDocument(app, documentConfig),
      { jsonDocumentUrl: ApiDocumentationBootstrap.JSON_PATH },
    );
  }
}
