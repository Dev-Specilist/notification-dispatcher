import { ExpansionClaim } from '@/modules/notification/application/port/out/expansion-job-repository.type';

export abstract class ExpansionQueuePort {
  abstract claimNext(now: Readonly<Date>, leaseUntil: Readonly<Date>): Promise<ExpansionClaim>;
}
