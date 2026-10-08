import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import {
  AlarmCompletion,
  AlarmId,
  AlarmSnapshot,
  CompletionEvidence,
  DeliveryCount,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/out/expansion-job-repository.port';
import { ExpansionJobLookup } from '@/modules/notification/application/port/out/expansion-job-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { CompleteAlarmIfSettledUseCase } from '@/modules/notification/application/port/in/complete-alarm-if-settled.use-case';

export class CompleteAlarmIfSettledService implements CompleteAlarmIfSettledUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  execute(alarmId: AlarmId): Promise<CompleteAlarmResult> {
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
