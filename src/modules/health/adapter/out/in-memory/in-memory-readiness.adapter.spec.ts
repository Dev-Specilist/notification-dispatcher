import { describe, expect, it } from 'vitest';
import { ReadinessPort } from '@/modules/health/application/port/out/readiness.port';
import { InMemoryReadinessAdapter } from '@/modules/health/adapter/out/in-memory/in-memory-readiness.adapter';

describe('InMemoryReadinessAdapter', () => {
  it('처음에는 트래픽을 받는 상태다', () => {
    const readiness: ReadinessPort = new InMemoryReadinessAdapter();

    expect(readiness.isAcceptingTraffic()).toBe(true);
  });

  it('트래픽 수신을 멈추면 다시 받지 않는 상태가 된다', () => {
    const readiness: ReadinessPort = new InMemoryReadinessAdapter();

    readiness.stopAcceptingTraffic();

    expect(readiness.isAcceptingTraffic()).toBe(false);
  });
});
