import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnvSchema } from '@/shared/config/env.type';
import { TypedConfigService } from '@/shared/config/typed-config.service';
import { EnvValidator } from '@/shared/config/env.validator';

@Module({})
export class TypedConfigModule {
  static forRoot(schema: EnvSchema): DynamicModule {
    return {
      module: TypedConfigModule,
      global: true,
      imports: [
        ConfigModule.forRoot({
          cache: true,
          ignoreEnvFile: true,
          validate: EnvValidator.for(schema),
        }),
      ],
      providers: [TypedConfigService],
      exports: [TypedConfigService],
    };
  }
}
