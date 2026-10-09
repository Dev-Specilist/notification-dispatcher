import { describe, expect, it } from 'vitest';
import { ReadinessPort } from '@/modules/health/application/port/driven/for-tracking-readiness/readiness.port';
import { ProcessReadinessAdapter } from '@/modules/health/adapter/driven/process-state/process-readiness.adapter';

describe('ProcessReadinessAdapter', () => {
  it('처음에는 트래픽을 받는 상태다', () => {
    const readiness: ReadinessPort = new ProcessReadinessAdapter();

    expect(readiness.isAcceptingTraffic()).toBe(true);
  });

  it('트래픽 수신을 멈추면 다시 받지 않는 상태가 된다', () => {
    const readiness: ReadinessPort = new ProcessReadinessAdapter();

    readiness.stopAcceptingTraffic();

    expect(readiness.isAcceptingTraffic()).toBe(false);
  });
});
