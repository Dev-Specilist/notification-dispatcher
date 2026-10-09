import { connect, createServer, Server, Socket } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorResult, TerminusModule } from '@nestjs/terminus';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseHealthIndicator } from '@/modules/health/adapter/driven/persistence/database.health-indicator';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { DatabaseModule } from '@/shared/database/database.module';
import { TestDatabase } from '@/shared/database/testing/test-database.helper';

interface SilentListener {
  readonly server: Server;
  readonly sockets: Set<Socket>;
}

interface TimedCheck {
  readonly result: HealthIndicatorResult;
  readonly elapsedMs: number;
}

const UNREACHABLE: HealthIndicatorResult = {
  database: { status: 'down', reason: 'database unreachable' },
};

const RESPONSE_DEADLINE_MS: number = 2_000;

const CONCURRENT_CHECKS: number = 10;

const RELEASE_DEADLINE_MS: number = 8_000;

const SLOW_TEST_TIMEOUT_MS: number = 20_000;

const listenSilently = async (): Promise<SilentListener> => {
  const sockets: Set<Socket> = new Set<Socket>();
  const server: Server = createServer((socket: Socket): void => {
    sockets.add(socket);
    socket.on('error', (): void => {});
  });
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, sockets };
};

const stop = async ({ server, sockets }: SilentListener): Promise<void> => {
  sockets.forEach((socket: Socket): void => {
    socket.destroy();
  });
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => resolve());
  });
};

const urlOf = ({ server }: SilentListener): string => {
  const address: ReturnType<Server['address']> = server.address();
  if (!(address instanceof Object) || typeof address === 'string') {
    throw new Error('silent server is not listening on a TCP port');
  }
  return `postgres://app:secret@127.0.0.1:${address.port}/notification`;
};

class FreezableProxy {
  private frozen: boolean = false;

  private readonly sockets: Set<Socket> = new Set<Socket>();

  private constructor(
    private readonly server: Server,
    readonly databaseUrl: string,
  ) {}

  static async inFrontOf(target: URL): Promise<FreezableProxy> {
    const holder: Set<FreezableProxy> = new Set<FreezableProxy>();
    const server: Server = createServer((client: Socket): void => {
      const upstream: Socket = connect(Number(target.port), target.hostname);
      holder.forEach((proxy: FreezableProxy): void => proxy.track(client, upstream));
      client.on('error', (): void => {});
      upstream.on('error', (): void => {});
      client.on('data', (chunk: Buffer): void => {
        upstream.write(chunk);
      });
      upstream.on('data', (chunk: Buffer): void => {
        holder.forEach((proxy: FreezableProxy): void => proxy.forward(client, chunk));
      });
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const proxied: URL = new URL(target.toString());
    proxied.hostname = '127.0.0.1';
    proxied.port = String(FreezableProxy.portOf(server));
    const proxy: FreezableProxy = new FreezableProxy(server, proxied.toString());
    holder.add(proxy);
    return proxy;
  }

  freeze(): void {
    this.frozen = true;
  }

  async stop(): Promise<void> {
    this.sockets.forEach((socket: Socket): void => {
      socket.destroy();
    });
    await new Promise<void>((resolve: () => void): void => {
      this.server.close((): void => resolve());
    });
  }

  private track(client: Socket, upstream: Socket): void {
    this.sockets.add(client);
    this.sockets.add(upstream);
  }

  private forward(client: Socket, chunk: Buffer): void {
    if (!this.frozen) {
      client.write(chunk);
    }
  }

  private static portOf(server: Server): number {
    const address: ReturnType<Server['address']> = server.address();
    if (!(address instanceof Object) || typeof address === 'string') {
      throw new Error('proxy is not listening on a TCP port');
    }
    return address.port;
  }
}

const compileWith = async (databaseUrl: string): Promise<TestingModule> => {
  vi.stubEnv('DATABASE_URL', databaseUrl);
  return Test.createTestingModule({
    imports: [
      TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000))),
      DatabaseModule,
      TerminusModule,
    ],
    providers: [DatabaseHealthIndicator],
  }).compile();
};

const timedCheck = async (indicator: DatabaseHealthIndicator): Promise<TimedCheck> => {
  const startedAt: number = performance.now();
  const result: HealthIndicatorResult = await indicator.check();
  return { result, elapsedMs: performance.now() - startedAt };
};

const waitUntilReleased = async (pool: Pool): Promise<boolean> => {
  const deadline: number = performance.now() + RELEASE_DEADLINE_MS;
  while (performance.now() < deadline) {
    if (pool.totalCount === 0 && pool.waitingCount === 0) {
      return true;
    }
    await setTimeout(50);
  }
  return false;
};

describe('DatabaseHealthIndicator', () => {
  let testDatabase: TestDatabase;
  let moduleRef: TestingModule;
  let silent: SilentListener;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
    silent = await listenSilently();
  });

  afterAll(async (): Promise<void> => {
    await stop(silent);
    await testDatabase.drop();
  });

  afterEach(async (): Promise<void> => {
    await moduleRef.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('DB에 쿼리할 수 있으면 up을 돌려준다', async (): Promise<void> => {
    moduleRef = await compileWith(testDatabase.databaseUrl);

    expect(await moduleRef.get(DatabaseHealthIndicator).check()).toEqual({
      database: { status: 'up' },
    });
    await moduleRef.get(Pool).end();
  });

  it('DB에 접속할 수 없으면 오류 내용을 노출하지 않고 down을 돌려준다', async (): Promise<void> => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((): void => {});
    const closed: SilentListener = await listenSilently();
    const url: string = urlOf(closed);
    await stop(closed);
    moduleRef = await compileWith(url);

    expect(await moduleRef.get(DatabaseHealthIndicator).check()).toEqual(UNREACHABLE);
    await moduleRef.get(Pool).end();
  });

  it(
    '운영 Pool 설정에서 DB가 응답하지 않으면 동시 체크가 모두 제한 시간 안에 down을 돌려주고, 연결과 대기 요청이 남지 않는다',
    async (): Promise<void> => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((): void => {});
      moduleRef = await compileWith(urlOf(silent));
      const indicator: DatabaseHealthIndicator = moduleRef.get(DatabaseHealthIndicator);
      const pool: Pool = moduleRef.get(Pool);

      const checks: ReadonlyArray<TimedCheck> = await Promise.all(
        Array.from({ length: CONCURRENT_CHECKS }, (): Promise<TimedCheck> => timedCheck(indicator)),
      );

      expect(checks.map(({ result }: TimedCheck): HealthIndicatorResult => result)).toEqual(
        Array.from({ length: CONCURRENT_CHECKS }, (): HealthIndicatorResult => UNREACHABLE),
      );
      expect(
        Math.max(...checks.map(({ elapsedMs }: TimedCheck): number => elapsedMs)),
      ).toBeLessThan(RESPONSE_DEADLINE_MS);
      expect(await waitUntilReleased(pool)).toBe(true);
      await pool.end();
      expect(pool.ended).toBe(true);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it('연결된 뒤 DB가 쿼리에 응답하지 않으면 제한 시간 안에 down을 돌려주고, 멈춘 연결을 Pool에 남기지 않는다', async (): Promise<void> => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((): void => {});
    const proxy: FreezableProxy = await FreezableProxy.inFrontOf(new URL(testDatabase.databaseUrl));
    try {
      moduleRef = await compileWith(proxy.databaseUrl);
      const indicator: DatabaseHealthIndicator = moduleRef.get(DatabaseHealthIndicator);
      const pool: Pool = moduleRef.get(Pool);
      expect(await indicator.check()).toEqual({ database: { status: 'up' } });
      expect(pool.totalCount).toBe(1);

      proxy.freeze();
      const { result, elapsedMs }: TimedCheck = await timedCheck(indicator);

      expect(result).toEqual(UNREACHABLE);
      expect(elapsedMs).toBeLessThan(RESPONSE_DEADLINE_MS);
      expect(await waitUntilReleased(pool)).toBe(true);
      await pool.end();
    } finally {
      await proxy.stop();
    }
  });
});
