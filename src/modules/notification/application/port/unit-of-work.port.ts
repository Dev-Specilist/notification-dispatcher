import { TransactionWork } from '@/modules/notification/application/port/unit-of-work.type';

export abstract class UnitOfWorkPort {
  abstract run<TResult>(work: TransactionWork<TResult>): Promise<TResult>;
}
