import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { IdGeneratorPort } from '@/modules/notification/application/port/out/id-generator.port';

@Injectable()
export class RandomIdGeneratorAdapter implements IdGeneratorPort {
  alarmId(): AlarmId {
    const id: string = randomUUID();
    if (!AlarmPredicates.isAlarmId(id)) {
      throw new Error(`generated ${id} is not a valid AlarmId`);
    }
    return id;
  }

  deliveryId(): DeliveryId {
    const id: string = randomUUID();
    if (!DeliveryPredicates.isDeliveryId(id)) {
      throw new Error(`generated ${id} is not a valid DeliveryId`);
    }
    return id;
  }
}
