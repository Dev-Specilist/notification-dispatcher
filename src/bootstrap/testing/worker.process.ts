import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export type WorkerEnvironment = Readonly<Record<string, string>>;

export class WorkerProcess {
  private static readonly HOST: string = '127.0.0.1';

  private static readonly SWC_BIN: string = join(process.cwd(), 'node_modules', '.bin', 'swc');

  private static readonly BUILD_ROOT: string = join(
    process.cwd(),
    'node_modules',
    '.cache',
    'worker-process',
  );

  private static readonly READY_TIMEOUT_MS: number = 15_000;

  private static readonly POLL_INTERVAL_MS: number = 50;

  private static readonly READY_STATUS: number = 200;

  private static readonly PROBE_TIMEOUT_MS: number = 1_000;

  readonly logs: Array<string> = [];

  readonly exited: Promise<void>;

  private hasExited: boolean = false;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    readonly url: string,
  ) {
    this.exited = new Promise<void>((resolve: () => void): void => {
      child.once('exit', (): void => {
        this.hasExited = true;
        resolve();
      });
    });
    child.stdout.on('data', (chunk: Buffer): void => {
      this.logs.push(chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer): void => {
      this.logs.push(chunk.toString());
    });
  }

  static build(): string {
    const buildDir: string = join(WorkerProcess.BUILD_ROOT, randomUUID());
    execFileSync(WorkerProcess.SWC_BIN, ['src', '-d', buildDir, '--strip-leading-paths']);
    return buildDir;
  }

  static async removeBuild(buildDir: string): Promise<void> {
    await rm(buildDir, { recursive: true, force: true });
  }

  static async start(buildDir: string, environment: WorkerEnvironment): Promise<WorkerProcess> {
    const port: number = await WorkerProcess.freePort();
    const child: ChildProcessWithoutNullStreams = spawn(
      process.execPath,
      ['--enable-source-maps', join(buildDir, 'worker.js')],
      { env: { HOST: WorkerProcess.HOST, PORT: String(port), LOG_FORMAT: 'json', ...environment } },
    );
    const worker: WorkerProcess = new WorkerProcess(child, `http://${WorkerProcess.HOST}:${port}`);
    try {
      await worker.waitUntilReady();
    } catch (failure) {
      await worker.kill();
      throw failure;
    }
    return worker;
  }

  get exitCode(): number {
    const { exitCode }: ChildProcessWithoutNullStreams = this.child;
    if (typeof exitCode !== 'number') {
      throw new Error(`worker has not exited normally: ${this.logs.join('')}`);
    }
    return exitCode;
  }

  async readinessStatus(timeoutMs: number = WorkerProcess.PROBE_TIMEOUT_MS): Promise<number> {
    const response: Response = await fetch(`${this.url}/readyz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.arrayBuffer();
    return response.status;
  }

  terminate(): void {
    this.child.kill('SIGTERM');
  }

  async kill(): Promise<void> {
    this.child.kill('SIGKILL');
    await this.exited;
  }

  private async waitUntilReady(): Promise<void> {
    const deadline: number = Date.now() + WorkerProcess.READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.hasExited) {
        throw new Error(`worker exited before becoming ready: ${this.logs.join('')}`);
      }
      const remainingMs: number = deadline - Date.now();
      if (
        (await this.probeReadiness(Math.min(remainingMs, WorkerProcess.PROBE_TIMEOUT_MS))) ===
        WorkerProcess.READY_STATUS
      ) {
        return;
      }
      await setTimeout(WorkerProcess.POLL_INTERVAL_MS);
    }
    throw new Error(`worker did not become ready: ${this.logs.join('')}`);
  }

  private async probeReadiness(timeoutMs: number): Promise<number> {
    try {
      return await this.readinessStatus(timeoutMs);
    } catch {
      return 0;
    }
  }

  private static async freePort(): Promise<number> {
    const probe: net.Server = net.createServer();
    await new Promise<void>((resolve: () => void, reject: (failure: Error) => void): void => {
      probe.once('error', (failure: Error): void => {
        probe.close();
        reject(failure);
      });
      probe.listen(0, WorkerProcess.HOST, resolve);
    });
    const address: ReturnType<net.Server['address']> = probe.address();
    await new Promise<void>((resolve: () => void): void => {
      probe.close((): void => resolve());
    });
    if (address && typeof address === 'object') {
      return address.port;
    }
    throw new Error('could not reserve a TCP port for the worker');
  }
}
