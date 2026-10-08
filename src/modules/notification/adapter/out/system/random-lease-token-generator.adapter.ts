import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/out/lease-token-generator.port';

@Injectable()
export class RandomLeaseTokenGeneratorAdapter implements LeaseTokenGeneratorPort {
  next(): LeaseToken {
    const rawLeaseToken: string = randomUUID();
    if (!DeliveryPredicates.isLeaseToken(rawLeaseToken)) {
      throw new Error(`generated ${rawLeaseToken} is not a valid LeaseToken`);
    }
    return rawLeaseToken;
  }
}
