import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/out/delivery-id-generator.port';
import { DispatchSettingsPort } from '@/modules/notification/application/port/out/dispatch-settings.port';
import { ExpansionSettingsPort } from '@/modules/notification/application/port/out/expansion-settings.port';
import { JitterSourcePort } from '@/modules/notification/application/port/out/jitter-source.port';
import { LeaseRecoverySettingsPort } from '@/modules/notification/application/port/out/lease-recovery-settings.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/out/lease-token-generator.port';
import { MessageLookupPort } from '@/modules/notification/application/port/out/message-lookup.port';
import { MessageSenderPort } from '@/modules/notification/application/port/out/message-sender.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/out/recipient-directory.port';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/out/reconcile-settings.port';
import { SendPermitPort } from '@/modules/notification/application/port/out/send-permit.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { CompleteAlarmIfSettledUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-alarm-if-settled.use-case';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.use-case';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.use-case';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.use-case';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.use-case';
import { CompleteAlarmIfSettledService } from '@/modules/notification/application/service/completion/complete-alarm-if-settled.service';
import { CompleteSettledAlarmsService } from '@/modules/notification/application/service/completion/complete-settled-alarms.service';
import { ExpandNextPageService } from '@/modules/notification/application/service/expansion/expand-next-page.service';
import { ReconcileNextDeliveryService } from '@/modules/notification/application/service/delivery/reconcile-next-delivery.service';
import { RecoverExpiredLeaseService } from '@/modules/notification/application/service/delivery/recover-expired-lease.service';
import { SendNextDeliveryService } from '@/modules/notification/application/service/delivery/send-next-delivery.service';
import { DispatchWorker } from '@/modules/notification/adapter/in/worker/dispatch.worker';
import { MockMessageLookupAdapter } from '@/modules/notification/adapter/out/external-api/mock-message-lookup.adapter';
import { MockMessageSenderAdapter } from '@/modules/notification/adapter/out/external-api/mock-message-sender.adapter';
import { MockRecipientDirectoryAdapter } from '@/modules/notification/adapter/out/external-api/mock-recipient-directory.adapter';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-transaction.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/out/persistence/notification-database.factory';
import { PostgresRateLimiterAdapter } from '@/modules/notification/adapter/out/persistence/postgres-rate-limiter.adapter';
import { RandomIdGeneratorAdapter } from '@/modules/notification/adapter/out/system/random-id-generator.adapter';
import { RandomJitterSourceAdapter } from '@/modules/notification/adapter/out/system/random-jitter-source.adapter';
import { RandomLeaseTokenGeneratorAdapter } from '@/modules/notification/adapter/out/system/random-lease-token-generator.adapter';
import { SystemClockAdapter } from '@/modules/notification/adapter/out/system/system-clock.adapter';
import { WorkerSettingsAdapter } from '@/modules/notification/adapter/out/system/worker-settings.adapter';
import { WorkerSettingsFactory } from '@/modules/notification/adapter/out/system/worker-settings.factory';
import { WorkerSettings } from '@/modules/notification/adapter/out/system/worker-settings.type';
import { TypedConfigService } from '@/shared/config/typed-config.service';

const WORKER_SETTINGS: string = 'WorkerSettings';

@Module({
  providers: [
    {
      provide: WORKER_SETTINGS,
      inject: [TypedConfigService],
      useFactory: (config: TypedConfigService): WorkerSettings =>
        WorkerSettingsFactory.fromConfig(config),
    },
    {
      provide: WorkerSettingsAdapter,
      inject: [WORKER_SETTINGS],
      useFactory: ({ deliverySettings }: WorkerSettings): WorkerSettingsAdapter => deliverySettings,
    },
    { provide: DispatchSettingsPort, useExisting: WorkerSettingsAdapter },
    { provide: ReconcileSettingsPort, useExisting: WorkerSettingsAdapter },
    { provide: LeaseRecoverySettingsPort, useExisting: WorkerSettingsAdapter },
    { provide: ExpansionSettingsPort, useExisting: WorkerSettingsAdapter },
    { provide: ClockPort, useClass: SystemClockAdapter },
    { provide: DeliveryIdGeneratorPort, useClass: RandomIdGeneratorAdapter },
    { provide: LeaseTokenGeneratorPort, useClass: RandomLeaseTokenGeneratorAdapter },
    { provide: JitterSourcePort, useClass: RandomJitterSourceAdapter },
    {
      provide: TransactionPort,
      inject: [Pool],
      useFactory: (pool: Pool): TransactionPort =>
        new DrizzleTransactionAdapter(NotificationDatabaseFactory.create(pool)),
    },
    {
      provide: SendPermitPort,
      inject: [Pool, WORKER_SETTINGS],
      useFactory: (pool: Pool, { rateLimiter }: WorkerSettings): SendPermitPort =>
        new PostgresRateLimiterAdapter(
          NotificationDatabaseFactory.create(pool),
          rateLimiter,
          PostgresRateLimiterAdapter.SERVER_CLOCK,
        ),
    },
    {
      provide: MessageSenderPort,
      inject: [WORKER_SETTINGS],
      useFactory: ({ mockApi }: WorkerSettings): MessageSenderPort =>
        new MockMessageSenderAdapter(mockApi),
    },
    {
      provide: MessageLookupPort,
      inject: [WORKER_SETTINGS],
      useFactory: ({ mockApi }: WorkerSettings): MessageLookupPort =>
        new MockMessageLookupAdapter(mockApi),
    },
    {
      provide: RecipientDirectoryPort,
      inject: [WORKER_SETTINGS],
      useFactory: ({ recipientDirectory }: WorkerSettings): RecipientDirectoryPort =>
        new MockRecipientDirectoryAdapter(recipientDirectory),
    },
    {
      provide: ExpandNextPageUseCase,
      inject: [
        TransactionPort,
        RecipientDirectoryPort,
        DeliveryIdGeneratorPort,
        ExpansionSettingsPort,
        ClockPort,
      ],
      useFactory: (
        transaction: TransactionPort,
        recipientDirectory: RecipientDirectoryPort,
        deliveryIdGenerator: DeliveryIdGeneratorPort,
        expansionSettings: ExpansionSettingsPort,
        clock: ClockPort,
      ): ExpandNextPageUseCase =>
        new ExpandNextPageService(
          transaction,
          recipientDirectory,
          deliveryIdGenerator,
          expansionSettings,
          clock,
        ),
    },
    {
      provide: SendNextDeliveryUseCase,
      inject: [
        TransactionPort,
        SendPermitPort,
        MessageSenderPort,
        LeaseTokenGeneratorPort,
        ClockPort,
        DispatchSettingsPort,
        JitterSourcePort,
      ],
      useFactory: (
        transaction: TransactionPort,
        sendPermit: SendPermitPort,
        messageSender: MessageSenderPort,
        leaseTokenGenerator: LeaseTokenGeneratorPort,
        clock: ClockPort,
        dispatchSettings: DispatchSettingsPort,
        jitterSource: JitterSourcePort,
      ): SendNextDeliveryUseCase =>
        new SendNextDeliveryService(
          transaction,
          sendPermit,
          messageSender,
          leaseTokenGenerator,
          clock,
          dispatchSettings,
          jitterSource,
        ),
    },
    {
      provide: ReconcileNextDeliveryUseCase,
      inject: [
        TransactionPort,
        MessageLookupPort,
        ClockPort,
        ReconcileSettingsPort,
        JitterSourcePort,
      ],
      useFactory: (
        transaction: TransactionPort,
        messageLookup: MessageLookupPort,
        clock: ClockPort,
        reconcileSettings: ReconcileSettingsPort,
        jitterSource: JitterSourcePort,
      ): ReconcileNextDeliveryUseCase =>
        new ReconcileNextDeliveryService(
          transaction,
          messageLookup,
          clock,
          reconcileSettings,
          jitterSource,
        ),
    },
    {
      provide: RecoverExpiredLeaseUseCase,
      inject: [TransactionPort, ClockPort, LeaseRecoverySettingsPort],
      useFactory: (
        transaction: TransactionPort,
        clock: ClockPort,
        leaseRecoverySettings: LeaseRecoverySettingsPort,
      ): RecoverExpiredLeaseUseCase =>
        new RecoverExpiredLeaseService(transaction, clock, leaseRecoverySettings),
    },
    {
      provide: CompleteAlarmIfSettledUseCase,
      inject: [TransactionPort, ClockPort],
      useFactory: (transaction: TransactionPort, clock: ClockPort): CompleteAlarmIfSettledUseCase =>
        new CompleteAlarmIfSettledService(transaction, clock),
    },
    {
      provide: CompleteSettledAlarmsUseCase,
      inject: [TransactionPort, CompleteAlarmIfSettledUseCase],
      useFactory: (
        transaction: TransactionPort,
        completeAlarmIfSettled: CompleteAlarmIfSettledUseCase,
      ): CompleteSettledAlarmsUseCase =>
        new CompleteSettledAlarmsService(transaction, completeAlarmIfSettled),
    },
    DispatchWorker,
  ],
})
export class NotificationWorkerModule {}
