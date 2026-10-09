import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId, LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';
import { IdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/id-generator.port';

@Injectable()
export class RandomIdGeneratorAdapter implements IdGeneratorPort {
  alarmId(): AlarmId {
    const rawAlarmId: string = randomUUID();
    if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
      throw new Error(`generated ${rawAlarmId} is not a valid AlarmId`);
    }
    return rawAlarmId;
  }

  deliveryId(): DeliveryId {
    const rawDeliveryId: string = randomUUID();
    if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
      throw new Error(`generated ${rawDeliveryId} is not a valid DeliveryId`);
    }
    return rawDeliveryId;
  }

  leaseToken(): LeaseToken {
    const rawLeaseToken: string = randomUUID();
    if (!DeliveryPredicates.isLeaseToken(rawLeaseToken)) {
      throw new Error(`generated ${rawLeaseToken} is not a valid LeaseToken`);
    }
    return rawLeaseToken;
  }
}
