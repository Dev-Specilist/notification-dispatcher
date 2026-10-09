import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { AlarmIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/alarm-id-generator.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/delivery-id-generator.port';

@Injectable()
export class RandomIdGeneratorAdapter implements AlarmIdGeneratorPort, DeliveryIdGeneratorPort {
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
}
