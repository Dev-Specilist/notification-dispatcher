import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';

export abstract class DeliveryRepositoryPort {
  abstract saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract findByAlarmId(alarmId: AlarmId): Promise<ReadonlyArray<Delivery>>;
}
