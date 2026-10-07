import { afterEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ServerBootstrap } from '@/bootstrap/server/server.bootstrap';

type ExitSpy = MockInstance<typeof process.exit>;

type FlushSpy = MockInstance<typeof Logger.flush>;

type FatalSpy = MockInstance<Logger['fatal']>;

class ExitCalled extends Error {}

const stubExit = (): ExitSpy =>
  vi.spyOn(process, 'exit').mockImplementation((): never => {
    throw new ExitCalled();
  });

describe('ServerBootstrap.run', () => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('기동이 성공하면 프로세스를 종료하지 않는다', async (): Promise<void> => {
    const exit: ExitSpy = stubExit();

    await ServerBootstrap.run((): Promise<void> => Promise.resolve());

    expect(exit).not.toHaveBeenCalled();
  });

  it('기동이 실패하면 버퍼 로그를 flush하고 fatal 로그를 남긴 뒤 exit(1)한다', async (): Promise<void> => {
    const exit: ExitSpy = stubExit();
    const flush: FlushSpy = vi.spyOn(Logger, 'flush');
    const fatal: FatalSpy = vi.spyOn(Logger.prototype, 'fatal').mockImplementation((): void => {});

    await expect(
      ServerBootstrap.run((): Promise<void> => Promise.reject(new Error('listen EADDRINUSE'))),
    ).rejects.toThrow(ExitCalled);

    expect(flush).toHaveBeenCalled();
    expect(fatal).toHaveBeenCalledWith(
      'failed to start: listen EADDRINUSE',
      expect.stringContaining('Error: listen EADDRINUSE'),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('Error가 아닌 값으로 실패해도 fatal 로그를 남기고 exit(1)한다', async (): Promise<void> => {
    const exit: ExitSpy = stubExit();
    const fatal: FatalSpy = vi.spyOn(Logger.prototype, 'fatal').mockImplementation((): void => {});

    await expect(
      ServerBootstrap.run((): Promise<void> => Promise.reject('port already bound')),
    ).rejects.toThrow(ExitCalled);

    expect(fatal).toHaveBeenCalledWith(
      'failed to start: port already bound',
      expect.stringContaining('Error: port already bound'),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
