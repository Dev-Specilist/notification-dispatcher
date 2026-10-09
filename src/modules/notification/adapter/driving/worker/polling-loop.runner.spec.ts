import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { PollingLoopRunner } from '@/modules/notification/adapter/driving/worker/polling-loop.runner';
import {
  PollingDelays,
  PollingOutcome,
} from '@/modules/notification/adapter/driving/worker/polling-loop.type';
import { timerDelayMsSchema } from '@/shared/config/primitive.schema';

type ErrorLogSpy = MockInstance<Logger['error']>;

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

const IDLE_DELAY_MS: number = 1_000;
const ERROR_DELAY_MS: number = 5_000;

const DELAYS: PollingDelays = {
  idleDelayMs: timerDelayMsSchema.parse(IDLE_DELAY_MS),
  errorDelayMs: timerDelayMsSchema.parse(ERROR_DELAY_MS),
};

const NOT_YET_OPENED: () => void = (): void => {};

const createGate = (): Gate => {
  let release: () => void = NOT_YET_OPENED;
  const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return { opened, open: (): void => release() };
};

class ScriptedWork {
  passes: number = 0;

  constructor(private readonly outcomes: ReadonlyArray<PollingOutcome>) {}

  run(): Promise<PollingOutcome> {
    const outcome: PollingOutcome = this.outcomes[Math.min(this.passes, this.outcomes.length - 1)];
    this.passes += 1;
    return Promise.resolve(outcome);
  }
}

describe('PollingLoopRunner', () => {
  let errorLog: ErrorLogSpy;

  beforeEach((): void => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation((): void => {});
  });

  afterEach((): void => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('할 일을 처리했으면 기다리지 않고 바로 다시 실행한다', async (): Promise<void> => {
    const work: ScriptedWork = new ScriptedWork(['worked', 'worked', 'worked', 'idle']);
    const loop: PollingLoopRunner = new PollingLoopRunner(
      'test',
      (): Promise<PollingOutcome> => work.run(),
      DELAYS,
    );

    loop.start();
    await vi.waitFor((): void => {
      expect(work.passes).toBe(4);
    });
    await loop.stop();

    expect(work.passes).toBe(4);
  });

  it('할 일이 없으면 쉬는 간격이 지나야 다시 실행한다', async (): Promise<void> => {
    const work: ScriptedWork = new ScriptedWork(['idle']);
    const loop: PollingLoopRunner = new PollingLoopRunner(
      'test',
      (): Promise<PollingOutcome> => work.run(),
      DELAYS,
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(IDLE_DELAY_MS - 1);
    const passesBeforeIdleDelay: number = work.passes;
    await vi.advanceTimersByTimeAsync(1);
    const passesAfterIdleDelay: number = work.passes;
    await loop.stop();

    expect(passesBeforeIdleDelay).toBe(1);
    expect(passesAfterIdleDelay).toBe(2);
  });

  it('실행이 실패하면 오류를 기록하고 오류 간격이 지난 뒤 루프를 이어간다', async (): Promise<void> => {
    const failures: Array<string> = [];
    const loop: PollingLoopRunner = new PollingLoopRunner(
      'test',
      (): Promise<PollingOutcome> => {
        failures.push('failed');
        return Promise.reject(new Error('database is unreachable'));
      },
      DELAYS,
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(ERROR_DELAY_MS - 1);
    const attemptsBeforeErrorDelay: number = failures.length;
    await vi.advanceTimersByTimeAsync(1);
    const attemptsAfterErrorDelay: number = failures.length;
    await loop.stop();

    expect(attemptsBeforeErrorDelay).toBe(1);
    expect(attemptsAfterErrorDelay).toBe(2);
    expect(errorLog).toHaveBeenCalledWith(
      'test pass failed: database is unreachable',
      expect.any(String),
    );
  });

  it('멈추면 쉬는 중이라도 바로 끝나고 더 실행하지 않는다', async (): Promise<void> => {
    const work: ScriptedWork = new ScriptedWork(['idle']);
    const loop: PollingLoopRunner = new PollingLoopRunner(
      'test',
      (): Promise<PollingOutcome> => work.run(),
      DELAYS,
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await loop.stop();
    const pendingTimersAfterStop: number = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(IDLE_DELAY_MS * 3);

    expect(pendingTimersAfterStop).toBe(0);
    expect(work.passes).toBe(1);
  });

  it('멈출 때 진행 중인 실행이 있으면 그 실행이 끝날 때까지 기다린다', async (): Promise<void> => {
    const passStarted: Gate = createGate();
    const passFinish: Gate = createGate();
    const finishedPasses: Array<string> = [];
    const loop: PollingLoopRunner = new PollingLoopRunner(
      'test',
      async (): Promise<PollingOutcome> => {
        passStarted.open();
        await passFinish.opened;
        finishedPasses.push('finished');
        return 'worked';
      },
      DELAYS,
    );
    loop.start();
    await passStarted.opened;
    let stopped: boolean = false;

    const stopping: Promise<void> = loop.stop().then((): void => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    const stoppedBeforePassFinished: boolean = stopped;
    passFinish.open();
    await stopping;

    expect(stoppedBeforePassFinished).toBe(false);
    expect(finishedPasses).toEqual(['finished']);
  });

  it('여러 번 시작해도 루프는 하나만 돌고, 멈출 때 진행 중인 실행이 끝날 때까지 기다린다', async (): Promise<void> => {
    const passStarted: Gate = createGate();
    const passFinish: Gate = createGate();
    const startedPasses: Array<string> = [];
    const loop: PollingLoopRunner = new PollingLoopRunner(
      'test',
      async (): Promise<PollingOutcome> => {
        startedPasses.push('started');
        passStarted.open();
        await passFinish.opened;
        return 'idle';
      },
      DELAYS,
    );
    loop.start();
    await passStarted.opened;
    loop.start();
    let stopped: boolean = false;

    const stopping: Promise<void> = loop.stop().then((): void => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    const stoppedBeforePassFinished: boolean = stopped;
    passFinish.open();
    await stopping;

    expect(stoppedBeforePassFinished).toBe(false);
    expect(startedPasses).toEqual(['started']);
  });
});
