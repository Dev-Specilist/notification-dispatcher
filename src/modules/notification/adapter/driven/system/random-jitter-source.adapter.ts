import { Injectable } from '@nestjs/common';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { JitterRatio } from '@/modules/notification/domain/delivery/delivery.type';
import { JitterSourcePort } from '@/modules/notification/application/port/driven/for-drawing-jitter/jitter-source.port';

@Injectable()
export class RandomJitterSourceAdapter implements JitterSourcePort {
  next(): JitterRatio {
    const rawJitterRatio: number = Math.random();
    if (!DeliveryPredicates.isJitterRatio(rawJitterRatio)) {
      throw new Error(`generated ${rawJitterRatio} is not a valid JitterRatio`);
    }
    return rawJitterRatio;
  }
}
