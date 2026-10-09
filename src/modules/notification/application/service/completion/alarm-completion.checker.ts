import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import {
  AlarmCompletion,
  AlarmId,
  CompletionEvidence,
  DeliveryCount,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';
import { ExpansionJobLookup } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { AlarmCompletionCheck } from '@/modules/notification/application/service/completion/alarm-completion.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';

type ExpansionJobReader = Pick<ExpansionJobRepositoryPort, 'findByAlarmId'>;

interface AlarmCompletionRepositories {
  readonly alarmRepository: Pick<AlarmRepositoryPort, 'findByIdForUpdate' | 'save'>;
  readonly deliveryRepository: Pick<DeliveryRepositoryPort, 'countUnsettled'>;
  readonly expansionJobRepository: ExpansionJobReader;
}

export class AlarmCompletionChecker {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  completeIfSettled(alarmId: AlarmId): Promise<AlarmCompletionCheck> {
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
        expansionJobRepository,
      }: AlarmCompletionRepositories): Promise<AlarmCompletionCheck> => {
        const lookup: AlarmLookup = await alarmRepository.findByIdForUpdate(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'skipped', reason: 'missing' };
        }
        const unsettledDeliveries: DeliveryCount = await deliveryRepository.countUnsettled(alarmId);
        const evidence: CompletionEvidence = {
          expansionCompleted: await AlarmCompletionChecker.isExpansionCompleted(
            lookup.alarm,
            alarmId,
            expansionJobRepository,
          ),
          unsettledDeliveries,
        };
        const completion: AlarmCompletion = lookup.alarm.complete(evidence, this.clock.now());
        switch (completion.kind) {
          case 'conflict':
            return { kind: 'skipped', reason: 'not-dispatching' };
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
    alarmId: AlarmId,
    expansionJobRepository: ExpansionJobReader,
  ): Promise<boolean> {
    if (!alarm.requiresExpansion()) {
      return true;
    }
    const lookup: ExpansionJobLookup = await expansionJobRepository.findByAlarmId(alarmId);
    return lookup.kind === 'found' && lookup.job.isCompleted();
  }
}
