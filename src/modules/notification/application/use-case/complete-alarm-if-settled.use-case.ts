import { Injectable } from '@nestjs/common';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import {
  AlarmCompletion,
  AlarmId,
  AlarmSnapshot,
  CompletionEvidence,
  DeliveryCount,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/expansion-job-repository.port';
import { ExpansionJobLookup } from '@/modules/notification/application/port/expansion-job-repository.type';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { CompleteAlarmResult } from '@/modules/notification/application/use-case/alarm-result.type';

@Injectable()
export class CompleteAlarmIfSettledUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly clock: ClockPort,
  ) {}

  execute(alarmId: AlarmId): Promise<CompleteAlarmResult> {
    return this.unitOfWork.run(
      async ({
        alarmRepository,
        deliveryRepository,
        expansionJobRepository,
      }: TransactionRepositories): Promise<CompleteAlarmResult> => {
        const lookup: AlarmLookup = await alarmRepository.findByIdForUpdate(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
        }
        const unsettledDeliveries: DeliveryCount = await deliveryRepository.countUnsettled(alarmId);
        const evidence: CompletionEvidence = {
          expansionCompleted: await CompleteAlarmIfSettledUseCase.isExpansionCompleted(
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
