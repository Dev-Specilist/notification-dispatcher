import { RecoveryAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.type';

export abstract class RecoverExpiredLeaseUseCase {
  abstract execute(): Promise<RecoveryAttempt>;
}
