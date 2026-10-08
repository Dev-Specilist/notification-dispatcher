import { TransactionWork } from '@/modules/notification/application/port/out/unit-of-work.type';

export abstract class UnitOfWorkPort {
  abstract run<TResult>(work: TransactionWork<TResult>): Promise<TResult>;
}
