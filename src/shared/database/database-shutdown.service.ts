import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  private markPoolClosed: () => void = (): void => {};

  private readonly poolClosed: Promise<void> = new Promise<void>((resolve: () => void): void => {
    this.markPoolClosed = resolve;
  });

  constructor(private readonly pool: Pool) {}

  whenPoolClosed(): Promise<void> {
    return this.poolClosed;
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.pool.ending) {
      await this.pool.end();
    }
    this.markPoolClosed();
  }
}
