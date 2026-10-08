import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import {
  SnapshotWork,
  TransactionWork,
} from '@/modules/notification/application/port/out/transaction.type';

export class UnusedTransaction implements TransactionPort {
  run<TResult>(_work: TransactionWork<TResult>): Promise<TResult> {
    return Promise.reject(new Error('transaction must not run'));
  }

  readSnapshot<TResult>(_work: SnapshotWork<TResult>): Promise<TResult> {
    return Promise.reject(new Error('transaction must not run'));
  }
}
