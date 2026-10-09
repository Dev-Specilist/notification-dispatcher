import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/out/delivery-id-generator.port';
import { ExpansionClaim } from '@/modules/notification/application/port/out/expansion-job-repository.type';
import { ExpansionSettingsPort } from '@/modules/notification/application/port/out/expansion-settings.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/out/recipient-directory.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { ExpansionPageRunner } from '@/modules/notification/application/service/expansion/expansion-page.runner';
import { ExpansionStep } from '@/modules/notification/application/service/expansion/expansion-page.type';

export class ExpandNextPageService implements ExpandNextPageUseCase {
  private readonly pageRunner: ExpansionPageRunner;

  constructor(
    private readonly transaction: TransactionPort,
    recipientDirectory: RecipientDirectoryPort,
    deliveryIdGenerator: DeliveryIdGeneratorPort,
    private readonly expansionSettings: ExpansionSettingsPort,
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
      ({ expansionQueue }: TransactionRepositories): Promise<ExpansionClaim> =>
        expansionQueue.claimNext(claimedAt, leaseUntil),
    );
    if (claim.kind === 'none') {
      return { kind: 'idle' };
    }
    const pageStep: ExpansionStep = await this.pageRunner.run(claim.alarmId);
    return { kind: 'expanded', alarmId: claim.alarmId, step: pageStep.kind };
  }
}
