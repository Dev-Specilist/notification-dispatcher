import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/out/delivery-id-generator.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/out/recipient-directory.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { AlarmCommand } from '@/modules/notification/application/port/in/alarm-command.type';
import { ExpansionResult } from '@/modules/notification/application/port/in/expand-recipients.type';
import { ExpandRecipientsUseCase } from '@/modules/notification/application/port/in/expand-recipients.use-case';
import { ExpansionPageRunner } from '@/modules/notification/application/service/expansion-page.runner';
import { ExpansionStep } from '@/modules/notification/application/service/expansion-page.type';

export class ExpandRecipientsService implements ExpandRecipientsUseCase {
  private readonly pageRunner: ExpansionPageRunner;

  constructor(
    transaction: TransactionPort,
    recipientDirectory: RecipientDirectoryPort,
    deliveryIdGenerator: DeliveryIdGeneratorPort,
    clock: ClockPort,
  ) {
    this.pageRunner = new ExpansionPageRunner(
      transaction,
      recipientDirectory,
      deliveryIdGenerator,
      clock,
    );
  }

  async execute({ alarmId }: Readonly<AlarmCommand>): Promise<ExpansionResult> {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      return { kind: 'not-found', alarmId };
    }
    let pageStep: ExpansionStep = await this.pageRunner.run(alarmId);
    while (pageStep.kind === 'continued') {
      pageStep = await this.pageRunner.run(alarmId);
    }
    return pageStep;
  }
}
