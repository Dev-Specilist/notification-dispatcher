import { AlarmNotFound } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-error.type';
import { AlarmView } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';
import { DeliveryProgressView } from '@/modules/notification/application/port/driving/for-managing-alarms/delivery-progress-view.type';

export interface GetAlarmQuery {
  readonly alarmId: string;
}

export interface AlarmFoundResult {
  readonly kind: 'found';
  readonly alarm: AlarmView;
  readonly deliveries: DeliveryProgressView;
}

export type GetAlarmResult = AlarmFoundResult | AlarmNotFound;
