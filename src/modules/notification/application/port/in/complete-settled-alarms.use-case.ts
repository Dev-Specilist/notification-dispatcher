import {
  CompleteSettledAlarmsCommand,
  SettledAlarmsPageChecked,
} from '@/modules/notification/application/port/in/complete-settled-alarms.type';

export abstract class CompleteSettledAlarmsUseCase {
  abstract execute(
    command: Readonly<CompleteSettledAlarmsCommand>,
  ): Promise<SettledAlarmsPageChecked>;
}
