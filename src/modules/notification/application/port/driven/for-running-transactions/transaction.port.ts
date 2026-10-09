import {
  SnapshotWork,
  TransactionWork,
} from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';

export abstract class TransactionPort {
  abstract run<TResult>(work: TransactionWork<TResult>): Promise<TResult>;

  abstract readSnapshot<TResult>(work: SnapshotWork<TResult>): Promise<TResult>;
}
