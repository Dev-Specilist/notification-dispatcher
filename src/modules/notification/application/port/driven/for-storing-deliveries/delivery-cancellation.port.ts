import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';

export abstract class DeliveryCancellationPort {
  abstract cancelWaiting(alarmId: AlarmId, now: Readonly<Date>): Promise<void>;
}
