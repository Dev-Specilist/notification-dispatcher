import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/out/expansion-job-repository.port';
import {
  ExpansionJob,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/out/expansion-job-repository.type';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/out/delivery-id-generator.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/out/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/out/recipient-directory.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import {
  ExpansionCancelled,
  ExpansionResult,
} from '@/modules/notification/application/port/in/expand-recipients.type';
import { ExpansionStep } from '@/modules/notification/application/service/expansion-page.type';

interface PageToFetch {
  readonly kind: 'fetch';
  readonly cursor: PageCursor;
}

type ExpansionStart = ExpansionResult | PageToFetch;

export class ExpansionPageRunner {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly recipientDirectory: RecipientDirectoryPort,
    private readonly deliveryIdGenerator: DeliveryIdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async run(alarmId: AlarmId): Promise<ExpansionStep> {
    const start: ExpansionStart = await this.transaction.run(
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
        if (ExpansionPageRunner.shouldStopExpansion(await alarmRepository.findById(alarmId))) {
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
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryCreation,
        expansionJobRepository,
      }: TransactionRepositories): Promise<ExpansionStep> => {
        const lockedJob: ExpansionJobLookup =
          await expansionJobRepository.findByAlarmIdForUpdate(alarmId);
        if (!ExpansionPageRunner.isStillAt(lockedJob, fetchedWith)) {
          return { kind: 'superseded' };
        }
        if (
          ExpansionPageRunner.shouldStopExpansion(await alarmRepository.findByIdForUpdate(alarmId))
        ) {
          return this.stop(expansionJobRepository, alarmId);
        }
        await deliveryCreation.insertMissing(
          recipientIds.map((recipientId: RecipientId): Delivery =>
            Delivery.create(
              { id: this.deliveryIdGenerator.deliveryId(), alarmId, recipientId, priority: 'BULK' },
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
    const storedCursor: PageCursor = lookup.job.progress.cursor;
    if (storedCursor.kind === 'first' || cursor.kind === 'first') {
      return storedCursor.kind === cursor.kind;
    }
    return storedCursor.token === cursor.token;
  }
}
