import { Injectable } from '@nestjs/common';
import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/expansion-job-repository.port';
import {
  ExpansionJob,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/expansion-job-repository.type';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/recipient-directory.type';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import {
  ExpansionCancelled,
  ExpansionResult,
} from '@/modules/notification/application/use-case/expand-recipients.type';

interface ExpansionContinues {
  readonly kind: 'continued';
}

type ExpansionStep = ExpansionResult | ExpansionContinues;

interface PageToFetch {
  readonly kind: 'fetch';
  readonly cursor: PageCursor;
}

type ExpansionStart = ExpansionResult | PageToFetch;

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
    const start: ExpansionStart = await this.unitOfWork.run(
      async ({
        alarmRepository,
        expansionJobRepository,
      }: TransactionRepositories): Promise<ExpansionStart> => {
        const lookup: ExpansionJobLookup = await expansionJobRepository.findByAlarmId(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'not-found', alarmId };
        }
        const { progress }: ExpansionJob = lookup.job;
        if (progress.kind === 'completed') {
          return { kind: 'completed' };
        }
        if (progress.kind === 'stopped') {
          return { kind: 'cancelled' };
        }
        if (ExpandRecipientsUseCase.shouldStopExpansion(await alarmRepository.findById(alarmId))) {
          return this.stop(expansionJobRepository, alarmId);
        }
        return { kind: 'fetch', cursor: progress.cursor };
      },
    );
    if (start.kind !== 'fetch') {
      return start;
    }
    const page: RecipientPage = await this.recipientDirectory.fetchPage(start.cursor);
    return this.commitPage(alarmId, start.cursor, page);
  }

  private commitPage(
    alarmId: AlarmId,
    fetchedWith: PageCursor,
    { recipientIds, next }: RecipientPage,
  ): Promise<ExpansionStep> {
    const now: Date = this.clock.now();
    return this.unitOfWork.run(
      async ({
        alarmRepository,
        deliveryRepository,
        expansionJobRepository,
      }: TransactionRepositories): Promise<ExpansionStep> => {
        const current: ExpansionJobLookup =
          await expansionJobRepository.findByAlarmIdForUpdate(alarmId);
        if (!ExpandRecipientsUseCase.isStillAt(current, fetchedWith)) {
          return { kind: 'superseded' };
        }
        if (
          ExpandRecipientsUseCase.shouldStopExpansion(
            await alarmRepository.findByIdForUpdate(alarmId),
          )
        ) {
          return this.stop(expansionJobRepository, alarmId);
        }
        await deliveryRepository.insertMissing(
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

  private async stop(
    expansionJobRepository: ExpansionJobRepositoryPort,
    alarmId: AlarmId,
  ): Promise<ExpansionCancelled> {
    await expansionJobRepository.recordProgress(alarmId, {
      kind: 'stopped',
      stoppedAt: this.clock.now(),
    });
    return { kind: 'cancelled' };
  }

  private static shouldStopExpansion(lookup: AlarmLookup): boolean {
    return lookup.kind === 'missing' || lookup.alarm.snapshot().state.status === 'CANCELLED';
  }

  private static isStillAt(lookup: ExpansionJobLookup, cursor: PageCursor): boolean {
    if (lookup.kind === 'missing' || lookup.job.progress.kind !== 'in-progress') {
      return false;
    }
    const current: PageCursor = lookup.job.progress.cursor;
    if (current.kind === 'first' || cursor.kind === 'first') {
      return current.kind === cursor.kind;
    }
    return current.token === cursor.token;
  }
}
