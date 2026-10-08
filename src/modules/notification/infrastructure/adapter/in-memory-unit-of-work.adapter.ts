import { Injectable } from '@nestjs/common';
import { UnitOfWorkPort } from '@/modules/notification/application/port/out/unit-of-work.port';
import { TransactionWork } from '@/modules/notification/application/port/out/unit-of-work.type';
import { InMemoryRepositories } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.type';
import { Rollback } from '@/modules/notification/infrastructure/adapter/rollback.type';

@Injectable()
export class InMemoryUnitOfWorkAdapter implements UnitOfWorkPort {
  private static readonly ignoreOutcome: () => void = (): void => {};

  constructor(private readonly repositories: InMemoryRepositories) {}

  private queue: Promise<void> = Promise.resolve();

  run<TResult>(work: TransactionWork<TResult>): Promise<TResult> {
    const result: Promise<TResult> = this.queue.then((): Promise<TResult> =>
      this.runWithRollback(work),
    );
    this.queue = result.then(
      InMemoryUnitOfWorkAdapter.ignoreOutcome,
      InMemoryUnitOfWorkAdapter.ignoreOutcome,
    );
    return result;
  }

  private async runWithRollback<TResult>(work: TransactionWork<TResult>): Promise<TResult> {
    const { alarmRepository, deliveryRepository, expansionJobRepository }: InMemoryRepositories =
      this.repositories;
    const rollbacks: ReadonlyArray<Rollback> = [
      alarmRepository.checkpoint(),
      deliveryRepository.checkpoint(),
      expansionJobRepository.checkpoint(),
    ];
    try {
      return await work(this.repositories);
    } catch (error) {
      rollbacks.forEach((rollback: Rollback): void => rollback());
      throw error;
    }
  }
}
