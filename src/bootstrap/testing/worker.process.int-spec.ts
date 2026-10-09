import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerProcess } from '@/bootstrap/testing/worker.process';

describe('WorkerProcess', () => {
  let buildDir: string;

  beforeAll((): void => {
    buildDir = WorkerProcess.build();
  });

  afterAll(async (): Promise<void> => {
    await WorkerProcess.removeBuild(buildDir);
  });

  it('워커가 준비되기 전에 종료되면 제한 시간까지 기다리지 않고 바로 실패한다', async (): Promise<void> => {
    const startedAt: number = Date.now();

    await expect(WorkerProcess.start(buildDir, {})).rejects.toThrow(
      'worker exited before becoming ready',
    );
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 20_000);
});
