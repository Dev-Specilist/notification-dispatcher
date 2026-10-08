import { RecoveryAttempt } from '@/modules/notification/application/port/in/recover-expired-lease.type';

export abstract class RecoverExpiredLeaseUseCase {
  abstract execute(): Promise<RecoveryAttempt>;
}
