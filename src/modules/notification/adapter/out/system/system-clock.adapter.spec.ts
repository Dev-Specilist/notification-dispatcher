import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemClockAdapter } from '@/modules/notification/adapter/out/system/system-clock.adapter';

const FIXED_ISO: string = '2026-10-08T09:00:00.123Z';

describe('SystemClockAdapter', () => {
  beforeEach((): void => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_ISO));
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('호출한 시점의 시스템 시각을 돌려준다', (): void => {
    expect(new SystemClockAdapter().now()).toEqual(new Date(FIXED_ISO));
  });

  it('시스템 시각이 흐르면 그 시각을 따라간다', (): void => {
    const clock: SystemClockAdapter = new SystemClockAdapter();

    vi.setSystemTime(new Date(Date.parse(FIXED_ISO) + 1_500));

    expect(clock.now().toISOString()).toBe('2026-10-08T09:00:01.623Z');
  });

  it('매번 새 Date를 돌려줘 호출한 쪽이 바꿔도 다음 값에 영향이 없다', (): void => {
    const clock: SystemClockAdapter = new SystemClockAdapter();
    const returnedNow: Date = clock.now();

    returnedNow.setUTCFullYear(1990);

    expect(clock.now()).toEqual(new Date(FIXED_ISO));
  });
});
