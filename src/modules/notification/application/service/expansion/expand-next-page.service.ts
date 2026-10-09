import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/id-generator.port';
import { ExpansionClaim } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { ExpansionSettings } from '@/modules/notification/application/service/expansion/expansion-settings.type';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { ExpansionPageRunner } from '@/modules/notification/application/service/expansion/expansion-page.runner';
import { ExpansionStep } from '@/modules/notification/application/service/expansion/expansion-page.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';

interface ExpandNextPageRepositories {
  readonly expansionJobRepository: Pick<ExpansionJobRepositoryPort, 'claimNext'>;
}

export class ExpandNextPageService implements ExpandNextPageUseCase {
  private readonly pageRunner: ExpansionPageRunner;

  constructor(
    private readonly transaction: TransactionPort,
    recipientDirectory: RecipientDirectoryPort,
    deliveryIdGenerator: Pick<IdGeneratorPort, 'deliveryId'>,
    private readonly expansionSettings: Readonly<ExpansionSettings>,
    private readonly clock: ClockPort,
  ) {
    this.pageRunner = new ExpansionPageRunner(
      transaction,
      recipientDirectory,
      deliveryIdGenerator,
      clock,
    );
  }

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
    const pageStep: ExpansionStep = await this.pageRunner.run(claim.alarmId);
    return { kind: 'expanded', alarmId: claim.alarmId, step: pageStep.kind };
  }
}
