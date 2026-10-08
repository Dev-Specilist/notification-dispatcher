import {
  SnapshotWork,
  TransactionWork,
} from '@/modules/notification/application/port/out/transaction.type';

export abstract class TransactionPort {
  abstract run<TResult>(work: TransactionWork<TResult>): Promise<TResult>;

  abstract readSnapshot<TResult>(work: SnapshotWork<TResult>): Promise<TResult>;
}
