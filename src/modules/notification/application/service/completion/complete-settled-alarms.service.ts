import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmSnapshot } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPredicates } from '@/modules/notification/application/port/out/alarm-repository.predicate';
import {
  AlarmPage,
  AlarmPageNext,
  AlarmPageStart,
  AlarmPosition,
  PageSize,
} from '@/modules/notification/application/port/out/alarm-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { SnapshotRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { CompleteAlarmIfSettledUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-alarm-if-settled.use-case';
import {
  AlarmCompletionFailure,
  CompleteSettledAlarmsCommand,
  SettledAlarmsPageChecked,
} from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.type';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.use-case';
import {
  ListNext,
  ListPosition,
  ListStart,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';

interface AlarmCompletionChecked {
  readonly kind: 'checked';
  readonly result: CompleteAlarmResult;
}

interface AlarmCompletionFailed {
  readonly kind: 'failed';
  readonly failure: AlarmCompletionFailure;
}

type AlarmCompletionAttempt = AlarmCompletionChecked | AlarmCompletionFailed;

export class CompleteSettledAlarmsService implements CompleteSettledAlarmsUseCase {
  private static readonly PAGE_SIZE: PageSize = CompleteSettledAlarmsService.pageSize(100);

  constructor(
    private readonly transaction: TransactionPort,
    private readonly completeAlarmIfSettled: CompleteAlarmIfSettledUseCase,
  ) {}

  async execute({
    start,
  }: Readonly<CompleteSettledAlarmsCommand>): Promise<SettledAlarmsPageChecked> {
    const page: AlarmPage = await this.dispatchingPage(
      CompleteSettledAlarmsService.toPageStart(start),
    );
    let completedAlarmCount: number = 0;
    const failures: Array<AlarmCompletionFailure> = [];
    for (const alarm of page.alarms) {
      const attempt: AlarmCompletionAttempt = await this.complete(alarm);
      if (attempt.kind === 'failed') {
        failures.push(attempt.failure);
      } else if (attempt.result.kind === 'completed') {
        completedAlarmCount += 1;
      }
    }
    return {
      kind: 'checked',
      checkedAlarmCount: page.alarms.length,
      completedAlarmCount,
      failures,
      next: CompleteSettledAlarmsService.toListNext(page.next),
    };
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

  private async complete(alarm: Alarm): Promise<AlarmCompletionAttempt> {
    const { id: alarmId }: AlarmSnapshot = alarm.snapshot();
    try {
      return { kind: 'checked', result: await this.completeAlarmIfSettled.execute({ alarmId }) };
    } catch (thrown) {
      const reason: string = thrown instanceof Error ? thrown.message : String(thrown);
      return { kind: 'failed', failure: { alarmId, reason } };
    }
  }

  private static toPageStart(start: Readonly<ListStart>): AlarmPageStart {
    if (start.kind === 'newest') {
      return start;
    }
    const { createdAt, alarmId }: ListPosition = start.position;
    if (!AlarmPredicates.isAlarmId(alarmId) || !Number.isFinite(createdAt.getTime())) {
      return { kind: 'newest' };
    }
    return { kind: 'after', position: { createdAt, id: alarmId } };
  }

  private static toListNext(next: AlarmPageNext): ListNext {
    if (next.kind === 'last') {
      return next;
    }
    const { createdAt, id: alarmId }: AlarmPosition = next.after;
    return { kind: 'more', after: { createdAt, alarmId } };
  }

  private static pageSize(rawPageSize: number): PageSize {
    if (!AlarmRepositoryPredicates.isPageSize(rawPageSize)) {
      throw new Error(`${rawPageSize} is not a valid page size`);
    }
    return rawPageSize;
  }
}
