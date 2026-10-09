import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmSnapshot } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPredicates } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.predicate';
import {
  AlarmPage,
  AlarmPageNext,
  AlarmPageStart,
  AlarmPosition,
  PageSize,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { SnapshotRepositories } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import { AlarmCompletionChecker } from '@/modules/notification/application/service/completion/alarm-completion.checker';
import { AlarmCompletionCheck } from '@/modules/notification/application/service/completion/alarm-completion.type';
import {
  AlarmCompletionFailure,
  CompleteSettledAlarmsCommand,
  CompletionScanNext,
  CompletionScanPosition,
  CompletionScanStart,
  SettledAlarmsPageChecked,
} from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.type';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.use-case';
import { ThrownValues } from '@/shared/error/thrown-value.util';

interface AlarmCompletionChecked {
  readonly kind: 'checked';
  readonly result: AlarmCompletionCheck;
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
    private readonly completionChecker: AlarmCompletionChecker,
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
      next: CompleteSettledAlarmsService.toScanNext(page.next),
    };
  }

  private dispatchingPage(start: Readonly<AlarmPageStart>): Promise<AlarmPage> {
    return this.transaction.readSnapshot(
      ({ alarmRepository }: SnapshotRepositories): Promise<AlarmPage> =>
        alarmRepository.findPage({
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
      return { kind: 'checked', result: await this.completionChecker.completeIfSettled(alarmId) };
    } catch (error) {
      const { message: reason }: Error = ThrownValues.toError(error);
      return { kind: 'failed', failure: { alarmId, reason } };
    }
  }

  private static toPageStart(start: Readonly<CompletionScanStart>): AlarmPageStart {
    if (start.kind === 'newest') {
      return start;
    }
    const { createdAt, alarmId }: CompletionScanPosition = start.position;
    if (!AlarmPredicates.isAlarmId(alarmId) || !Number.isFinite(createdAt.getTime())) {
      return { kind: 'newest' };
    }
    return { kind: 'after', position: { createdAt, id: alarmId } };
  }

  private static toScanNext(next: AlarmPageNext): CompletionScanNext {
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
