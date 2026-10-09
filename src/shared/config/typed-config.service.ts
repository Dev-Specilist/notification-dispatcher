import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/shared/config/env.type';

@Injectable()
export class TypedConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<TKey extends keyof Env>(key: TKey): Env[TKey] {
    return this.config.get(key, { infer: true });
  }
}
