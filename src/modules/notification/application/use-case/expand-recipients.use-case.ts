import { Injectable } from '@nestjs/common';
import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import {
  ExpansionJob,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/expansion-job-repository.type';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/recipient-directory.port';
import { RecipientPage } from '@/modules/notification/application/port/recipient-directory.type';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { ExpansionResult } from '@/modules/notification/application/use-case/expand-recipients.type';

interface ExpansionContinues {
  readonly kind: 'continued';
}

type ExpansionStep = ExpansionResult | ExpansionContinues;

@Injectable()
export class ExpandRecipientsUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly recipientDirectory: RecipientDirectoryPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(alarmId: AlarmId): Promise<ExpansionResult> {
    let step: ExpansionStep = await this.expandNextPage(alarmId);
    while (step.kind === 'continued') {
      step = await this.expandNextPage(alarmId);
    }
    return step;
  }

  private async expandNextPage(alarmId: AlarmId): Promise<ExpansionStep> {
    const lookup: ExpansionJobLookup = await this.unitOfWork.run(
      ({ expansionJobRepository }: TransactionRepositories): Promise<ExpansionJobLookup> =>
        expansionJobRepository.findByAlarmId(alarmId),
    );
    if (lookup.kind === 'missing') {
      return { kind: 'not-found', alarmId };
    }
    const { progress }: ExpansionJob = lookup.job;
    if (progress.kind === 'completed') {
      return { kind: 'completed' };
    }
    const page: RecipientPage = await this.recipientDirectory.fetchPage(progress.cursor);
    return this.commitPage(alarmId, page);
  }

  private commitPage(
    alarmId: AlarmId,
    { recipientIds, next }: RecipientPage,
  ): Promise<ExpansionStep> {
    const now: Date = this.clock.now();
    return this.unitOfWork.run(
      async ({
        deliveryRepository,
        expansionJobRepository,
      }: TransactionRepositories): Promise<ExpansionStep> => {
        await deliveryRepository.saveAll(
          recipientIds.map((recipientId: RecipientId): Delivery =>
            Delivery.create(
              { id: this.idGenerator.deliveryId(), alarmId, recipientId, priority: 'BULK' },
              now,
            ),
          ),
        );
        if (next.kind === 'end') {
          await expansionJobRepository.recordProgress(alarmId, {
            kind: 'completed',
            completedAt: now,
          });
          return { kind: 'completed' };
        }
        await expansionJobRepository.recordProgress(alarmId, { kind: 'in-progress', cursor: next });
        return { kind: 'continued' };
      },
    );
  }
}
