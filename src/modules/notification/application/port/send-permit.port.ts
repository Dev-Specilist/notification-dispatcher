import { SendPermit } from '@/modules/notification/application/port/send-permit.type';

export abstract class SendPermitPort {
  abstract acquire(): Promise<SendPermit>;
}
