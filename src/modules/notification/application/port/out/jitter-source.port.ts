import { JitterRatio } from '@/modules/notification/domain/delivery/delivery.type';

export abstract class JitterSourcePort {
  abstract next(): JitterRatio;
}
