import { Brand } from '@/shared/domain/brand.type';

export type RequestTimeoutMs = number & Brand<'RequestTimeoutMs'>;

export interface MockApiSettings {
  readonly baseUrl: URL;
  readonly requestTimeoutMs: RequestTimeoutMs;
}
