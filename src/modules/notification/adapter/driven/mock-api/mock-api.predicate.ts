import {
  RequestTimeoutMs,
  UserPageLimit,
} from '@/modules/notification/adapter/driven/mock-api/mock-api.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';

export class MockApiPredicates {
  private static readonly MAX_USER_PAGE_LIMIT: number = 1_000;

  static isRequestTimeoutMs(value: number): value is RequestTimeoutMs {
    return (
      Number.isSafeInteger(value) && value >= 1 && value <= DurationPredicates.MAX_TIMER_DELAY_MS
    );
  }

  static isUserPageLimit(value: number): value is UserPageLimit {
    return (
      Number.isSafeInteger(value) && value >= 1 && value <= MockApiPredicates.MAX_USER_PAGE_LIMIT
    );
  }
}
