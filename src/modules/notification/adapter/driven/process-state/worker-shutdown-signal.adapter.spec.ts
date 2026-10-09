import { describe, expect, it } from 'vitest';
import { WorkerShutdownSignalAdapter } from '@/modules/notification/adapter/driven/process-state/worker-shutdown-signal.adapter';

describe('WorkerShutdownSignalAdapter', () => {
  it('종료를 요청해도 진행 중인 외부 요청의 중단 신호는 켜지지 않는다', (): void => {
    const shutdownSignal: WorkerShutdownSignalAdapter = new WorkerShutdownSignalAdapter();

    shutdownSignal.request();

    expect(shutdownSignal.isRequested()).toBe(true);
    expect(shutdownSignal.outgoingRequestAbortSignal.aborted).toBe(false);
  });

  it('외부 요청 중단을 요청하면 외부 요청이 함께 쓰는 중단 신호가 켜진다', (): void => {
    const shutdownSignal: WorkerShutdownSignalAdapter = new WorkerShutdownSignalAdapter();

    shutdownSignal.abortOutgoingRequests();

    expect(shutdownSignal.outgoingRequestAbortSignal.aborted).toBe(true);
  });
});
