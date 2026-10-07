import { SendPermit } from '@/modules/notification/application/port/send-permit.type';
import { RetryAfterMs } from '@/modules/notification/domain/delivery/delivery.type';

export abstract class SendPermitPort {
  abstract acquire(): Promise<SendPermit>;

  abstract holdFor(retryAfterMs: RetryAfterMs): Promise<void>;
}
