import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryId, LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';

export abstract class IdGeneratorPort {
  abstract alarmId(): AlarmId;
  abstract deliveryId(): DeliveryId;
  abstract leaseToken(): LeaseToken;
}
