import { AlarmId, DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';

export abstract class DeliveryProgressPort {
  abstract countUnsettled(alarmId: AlarmId): Promise<DeliveryCount>;
}
