import { LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';

export abstract class LeaseTokenGeneratorPort {
  abstract next(): LeaseToken;
}
