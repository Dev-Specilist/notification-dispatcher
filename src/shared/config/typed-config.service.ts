import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/shared/config/env.type';

@Injectable()
export class TypedConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  public get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }
}
