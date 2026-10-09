import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmSnapshot } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPredicates } from '@/modules/notification/application/port/out/alarm-repository.predicate';
import {
  AlarmPage,
  AlarmPageStart,
  PageSize,
} from '@/modules/notification/application/port/out/alarm-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { SnapshotRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { CompleteAlarmIfSettledUseCase } from '@/modules/notification/application/port/in/complete-alarm-if-settled.use-case';
import { SettledAlarmsSwept } from '@/modules/notification/application/port/in/complete-settled-alarms.type';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/in/complete-settled-alarms.use-case';

export class CompleteSettledAlarmsService implements CompleteSettledAlarmsUseCase {
  private static readonly PAGE_SIZE: PageSize = CompleteSettledAlarmsService.pageSize(100);

  constructor(
    private readonly transaction: TransactionPort,
    private readonly completeAlarmIfSettled: CompleteAlarmIfSettledUseCase,
  ) {}

  async execute(): Promise<SettledAlarmsSwept> {
    let checkedAlarmCount: number = 0;
    let completedAlarmCount: number = 0;
    let start: AlarmPageStart = { kind: 'newest' };
    let page: AlarmPage;
    do {
      page = await this.dispatchingPage(start);
      for (const alarm of page.alarms) {
        checkedAlarmCount += 1;
        if ((await this.complete(alarm)).kind === 'completed') {
          completedAlarmCount += 1;
        }
      }
      if (page.next.kind === 'more') {
        start = { kind: 'after', position: page.next.after };
      }
    } while (page.next.kind === 'more');
    return { kind: 'swept', checkedAlarmCount, completedAlarmCount };
  }

  private dispatchingPage(start: Readonly<AlarmPageStart>): Promise<AlarmPage> {
    return this.transaction.readSnapshot(
      ({ alarmReader }: SnapshotRepositories): Promise<AlarmPage> =>
        alarmReader.findPage({
          status: { kind: 'exactly', value: 'DISPATCHING' },
          alarmKind: { kind: 'any' },
          start,
          size: CompleteSettledAlarmsService.PAGE_SIZE,
        }),
    );
  }

  private complete(alarm: Alarm): Promise<CompleteAlarmResult> {
    const { id: alarmId }: AlarmSnapshot = alarm.snapshot();
    return this.completeAlarmIfSettled.execute({ alarmId });
  }

  private static pageSize(rawPageSize: number): PageSize {
    if (!AlarmRepositoryPredicates.isPageSize(rawPageSize)) {
      throw new Error(`${rawPageSize} is not a valid page size`);
    }
    return rawPageSize;
  }
}
