import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';

export abstract class IdGeneratorPort {
  abstract alarmId(): AlarmId;

  abstract deliveryId(): DeliveryId;
}
