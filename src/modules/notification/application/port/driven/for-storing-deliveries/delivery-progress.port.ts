import { AlarmId, DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryStatusCounts } from '@/modules/notification/domain/delivery/delivery.type';

export abstract class DeliveryProgressPort {
  abstract countUnsettled(alarmId: AlarmId): Promise<DeliveryCount>;

  abstract countByStatus(alarmId: AlarmId): Promise<DeliveryStatusCounts>;
}
