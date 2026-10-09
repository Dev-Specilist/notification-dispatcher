import { Brand } from '@/shared/domain/brand.type';

export type RequestTimeoutMs = number & Brand<'RequestTimeoutMs'>;

export type UserPageLimit = number & Brand<'UserPageLimit'>;

export interface TransportFailures<TResult> {
  readonly notConnected: TResult;
  readonly interrupted: TResult;
}

export interface MockApiSettings {
  readonly baseUrl: URL;
  readonly requestTimeoutMs: RequestTimeoutMs;
}

export interface RecipientDirectorySettings extends MockApiSettings {
  readonly pageLimit: UserPageLimit;
}
