import { SendPermit } from '@/modules/notification/application/port/send-permit.type';
import { DurationMs } from '@/shared/domain/duration.type';

export abstract class SendPermitPort {
  abstract acquire(): Promise<SendPermit>;

  abstract holdFor(retryAfterMs: DurationMs): Promise<void>;
}
