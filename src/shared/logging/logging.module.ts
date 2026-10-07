import { DynamicModule, Module } from '@nestjs/common';
import { ProcessRole } from '@/shared/config/primitive.schema';
import { TypedConfigService } from '@/shared/config/typed-config.service';
import { AppLogger } from '@/shared/logging/app.logger';

@Module({})
export class LoggingModule {
  static forRoot(role: ProcessRole): DynamicModule {
    return {
      module: LoggingModule,
      global: true,
      providers: [
        {
          provide: AppLogger,
          inject: [TypedConfigService],
          useFactory: (config: TypedConfigService): AppLogger =>
            AppLogger.create({
              level: config.get('LOG_LEVEL'),
              format: config.get('LOG_FORMAT'),
              role,
            }),
        },
      ],
      exports: [AppLogger],
    };
  }
}
