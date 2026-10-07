import { RequestTimeoutMs } from '@/modules/notification/infrastructure/adapter/mock-api.type';

export class MockApiPredicates {
  private static readonly MAX_TIMER_DELAY_MS: number = 2_147_483_647;

  static isRequestTimeoutMs(value: number): value is RequestTimeoutMs {
    return (
      Number.isSafeInteger(value) && value >= 1 && value <= MockApiPredicates.MAX_TIMER_DELAY_MS
    );
  }
}
