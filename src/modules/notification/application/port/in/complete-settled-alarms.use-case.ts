import { SettledAlarmsSwept } from '@/modules/notification/application/port/in/complete-settled-alarms.type';

export abstract class CompleteSettledAlarmsUseCase {
  abstract execute(): Promise<SettledAlarmsSwept>;
}
