import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import {
  SnapshotWork,
  TransactionWork,
} from '@/modules/notification/application/port/out/transaction.type';

export class SnapshotOnlyTransaction implements TransactionPort {
  constructor(private readonly snapshotSource: TransactionPort) {}

  run<TResult>(_work: TransactionWork<TResult>): Promise<TResult> {
    return Promise.reject(new Error('this lookup must read through a snapshot'));
  }

  readSnapshot<TResult>(work: SnapshotWork<TResult>): Promise<TResult> {
    return this.snapshotSource.readSnapshot(work);
  }
}
