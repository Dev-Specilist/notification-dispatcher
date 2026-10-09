import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import {
  ExpansionCursor,
  ExpansionNextPage,
  PageToFetch,
} from '@/modules/notification/domain/expansion/expansion-job.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/id-generator.port';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';
import {
  ExpansionClaim,
  ExpansionClaimed,
  ExpansionJobFound,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.port';
import { RecipientPage } from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import {
  ExpansionPageAttempt,
  ExpansionPageStepName,
} from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { AcceptedTransition } from '@/modules/notification/application/service/accepted-transition.util';
import { ExpansionSettings } from '@/modules/notification/application/service/expansion/expansion-settings.type';

type ExpansionJobWriter = Pick<ExpansionJobRepositoryPort, 'save'>;

interface ExpandNextPageRepositories {
  readonly alarmRepository: Pick<AlarmRepositoryPort, 'findById' | 'findByIdForUpdate'>;
  readonly deliveryRepository: Pick<DeliveryRepositoryPort, 'insertMissing'>;
  readonly expansionJobRepository: Pick<
    ExpansionJobRepositoryPort,
    'claimNext' | 'findByAlarmId' | 'findByAlarmIdForUpdate' | 'save'
  >;
}

interface PageStepSettled {
  readonly kind: 'settled';
  readonly step: ExpansionPageStepName;
}

type PageStart = PageToFetch | PageStepSettled;

export class ExpandNextPageService implements ExpandNextPageUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly recipientDirectory: RecipientDirectoryPort,
    private readonly deliveryIdGenerator: Pick<IdGeneratorPort, 'deliveryId'>,
    private readonly expansionSettings: Readonly<ExpansionSettings>,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<ExpansionPageAttempt> {
    const claimedAt: Date = this.clock.now();
    const leaseUntil: Date = new Date(claimedAt.getTime() + this.expansionSettings.leaseMs);
    const claim: ExpansionClaim = await this.transaction.run(
      ({ expansionJobRepository }: ExpandNextPageRepositories): Promise<ExpansionClaim> =>
        expansionJobRepository.claimNext(claimedAt, leaseUntil),
    );
    if (claim.kind === 'none') {
      return { kind: 'idle' };
    }
    const { alarmId }: ExpansionClaimed = claim;
    return { kind: 'expanded', alarmId, step: await this.expandPage(alarmId) };
  }

  private async expandPage(alarmId: AlarmId): Promise<ExpansionPageStepName> {
    const start: PageStart = await this.startPage(alarmId);
    if (start.kind === 'settled') {
      return start.step;
    }
    const page: RecipientPage = await this.recipientDirectory.fetchPage(start.cursor);
    return this.commitPage(alarmId, start.cursor, page);
  }

  private startPage(alarmId: AlarmId): Promise<PageStart> {
    return this.transaction.run(
      async ({
        alarmRepository,
        expansionJobRepository,
      }: ExpandNextPageRepositories): Promise<PageStart> => {
        const job: ExpansionJob = ExpandNextPageService.claimedJob(
          alarmId,
          await expansionJobRepository.findByAlarmId(alarmId),
        );
        const nextPage: ExpansionNextPage = job.nextPage();
        switch (nextPage.kind) {
          case 'completed':
            return { kind: 'settled', step: 'completed' };
          case 'stopped':
            return { kind: 'settled', step: 'cancelled' };
          case 'fetch':
            break;
        }
        if (ExpandNextPageService.shouldStopExpansion(await alarmRepository.findById(alarmId))) {
          return { kind: 'settled', step: await this.stop(expansionJobRepository, job) };
        }
        return nextPage;
      },
    );
  }

  private commitPage(
    alarmId: AlarmId,
    fetchedWith: ExpansionCursor,
    { recipientIds, next }: RecipientPage,
  ): Promise<ExpansionPageStepName> {
    const now: Date = this.clock.now();
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
        expansionJobRepository,
      }: ExpandNextPageRepositories): Promise<ExpansionPageStepName> => {
        const locked: ExpansionJobLookup =
          await expansionJobRepository.findByAlarmIdForUpdate(alarmId);
        if (locked.kind === 'missing' || !locked.job.isAt(fetchedWith)) {
          return 'superseded';
        }
        const { job }: ExpansionJobFound = locked;
        if (
          ExpandNextPageService.shouldStopExpansion(
            await alarmRepository.findByIdForUpdate(alarmId),
          )
        ) {
          return this.stop(expansionJobRepository, job);
        }
        await deliveryRepository.insertMissing(
          recipientIds.map((recipientId: RecipientId): Delivery =>
            Delivery.create(
              { id: this.deliveryIdGenerator.deliveryId(), alarmId, recipientId, priority: 'BULK' },
              now,
            ),
          ),
        );
        const advanced: ExpansionJob = AcceptedTransition.expansionJob(job.advance(next, now));
        await expansionJobRepository.save(advanced);
        return advanced.isCompleted() ? 'completed' : 'continued';
      },
    );
  }

  private async stop(
    expansionJobRepository: ExpansionJobWriter,
    job: ExpansionJob,
  ): Promise<ExpansionPageStepName> {
    await expansionJobRepository.save(AcceptedTransition.expansionJob(job.stop(this.clock.now())));
    return 'cancelled';
  }

  private static claimedJob(alarmId: AlarmId, lookup: ExpansionJobLookup): ExpansionJob {
    if (lookup.kind === 'missing') {
      throw new Error(`claimed expansion job for alarm ${alarmId} does not exist`);
    }
    return lookup.job;
  }

  private static shouldStopExpansion(lookup: AlarmLookup): boolean {
    return lookup.kind === 'missing' || lookup.alarm.snapshot().state.status === 'CANCELLED';
  }
}
