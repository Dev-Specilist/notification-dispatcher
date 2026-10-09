import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import {
  AlarmCompletion,
  AlarmSnapshot,
  CompletionEvidence,
  DeliveryCount,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';
import { ExpansionJobLookup } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import { AlarmCommand } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-command.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { CompleteAlarmIfSettledUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-alarm-if-settled.use-case';

export class CompleteAlarmIfSettledService implements CompleteAlarmIfSettledUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  execute({ alarmId }: Readonly<AlarmCommand>): Promise<CompleteAlarmResult> {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      return Promise.resolve({ kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } });
    }
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryProgress,
        expansionJobRepository,
      }: TransactionRepositories): Promise<CompleteAlarmResult> => {
        const lookup: AlarmLookup = await alarmRepository.findByIdForUpdate(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
        }
        const unsettledDeliveries: DeliveryCount = await deliveryProgress.countUnsettled(alarmId);
        const evidence: CompletionEvidence = {
          expansionCompleted: await CompleteAlarmIfSettledService.isExpansionCompleted(
            lookup.alarm,
            expansionJobRepository,
          ),
          unsettledDeliveries,
        };
        const completion: AlarmCompletion = lookup.alarm.complete(evidence, this.clock.now());
        switch (completion.kind) {
          case 'conflict':
            return completion;
          case 'unchanged':
            return { kind: 'not-yet' };
          case 'transitioned':
            break;
        }
        await alarmRepository.save(completion.alarm);
        return { kind: 'completed' };
      },
    );
  }

  private static async isExpansionCompleted(
    alarm: Alarm,
    expansionJobRepository: ExpansionJobRepositoryPort,
  ): Promise<boolean> {
    const { id, kind }: AlarmSnapshot = alarm.snapshot();
    if (kind === 'URGENT') {
      return true;
    }
    const lookup: ExpansionJobLookup = await expansionJobRepository.findByAlarmId(id);
    return lookup.kind === 'found' && lookup.job.progress.kind === 'completed';
  }
}
