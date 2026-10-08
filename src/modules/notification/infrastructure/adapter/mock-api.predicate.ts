import {
  RequestTimeoutMs,
  UserPageLimit,
} from '@/modules/notification/infrastructure/adapter/mock-api.type';

export class MockApiPredicates {
  private static readonly MAX_TIMER_DELAY_MS: number = 2_147_483_647;

  private static readonly MAX_USER_PAGE_LIMIT: number = 1_000;

  static isRequestTimeoutMs(value: number): value is RequestTimeoutMs {
    return (
      Number.isSafeInteger(value) && value >= 1 && value <= MockApiPredicates.MAX_TIMER_DELAY_MS
    );
  }

  static isUserPageLimit(value: number): value is UserPageLimit {
    return (
      Number.isSafeInteger(value) && value >= 1 && value <= MockApiPredicates.MAX_USER_PAGE_LIMIT
    );
  }
}
