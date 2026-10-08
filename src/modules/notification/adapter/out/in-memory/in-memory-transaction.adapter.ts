import { Injectable } from '@nestjs/common';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import {
  SnapshotWork,
  TransactionWork,
} from '@/modules/notification/application/port/out/transaction.type';
import { InMemoryRepositories } from '@/modules/notification/adapter/out/in-memory/in-memory-transaction.type';
import { Rollback } from '@/modules/notification/adapter/out/in-memory/rollback.type';

@Injectable()
export class InMemoryTransactionAdapter implements TransactionPort {
  private static readonly ignoreOutcome: () => void = (): void => {};

  constructor(private readonly repositories: InMemoryRepositories) {}

  private queue: Promise<void> = Promise.resolve();

  run<TResult>(work: TransactionWork<TResult>): Promise<TResult> {
    const result: Promise<TResult> = this.queue.then((): Promise<TResult> =>
      this.runWithRollback(work),
    );
    this.queue = result.then(
      InMemoryTransactionAdapter.ignoreOutcome,
      InMemoryTransactionAdapter.ignoreOutcome,
    );
    return result;
  }

  readSnapshot<TResult>(work: SnapshotWork<TResult>): Promise<TResult> {
    const { alarmRepository, deliveryRepository }: InMemoryRepositories = this.repositories;
    return this.run((): Promise<TResult> =>
      work({ alarmReader: alarmRepository, deliveryProgress: deliveryRepository }),
    );
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
      return await work({
        alarmRepository,
        deliveryCreation: deliveryRepository,
        dispatchQueue: deliveryRepository,
        leaseRecoveryQueue: deliveryRepository,
        reconcileQueue: deliveryRepository,
        deliveryCancellation: deliveryRepository,
        deliveryProgress: deliveryRepository,
        expansionJobRepository,
      });
    } catch (error) {
      rollbacks.forEach((rollback: Rollback): void => rollback());
      throw error;
    }
  }
}
