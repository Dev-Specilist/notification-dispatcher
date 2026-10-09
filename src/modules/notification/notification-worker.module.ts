import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/delivery-id-generator.port';
import { JitterSourcePort } from '@/modules/notification/application/port/driven/for-drawing-jitter/jitter-source.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/lease-token-generator.port';
import { MessageLookupPort } from '@/modules/notification/application/port/driven/for-looking-up-messages/message-lookup.port';
import { MessageSenderPort } from '@/modules/notification/application/port/driven/for-sending-messages/message-sender.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.port';
import { SendPermitPort } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.use-case';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.use-case';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.use-case';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.use-case';
import { AlarmCompletionChecker } from '@/modules/notification/application/service/completion/alarm-completion.checker';
import { CompleteSettledAlarmsService } from '@/modules/notification/application/service/completion/complete-settled-alarms.service';
import { ExpandNextPageService } from '@/modules/notification/application/service/expansion/expand-next-page.service';
import { ReconcileNextDeliveryService } from '@/modules/notification/application/service/delivery/reconcile-next-delivery.service';
import { RecoverExpiredLeaseService } from '@/modules/notification/application/service/delivery/recover-expired-lease.service';
import { SendNextDeliveryService } from '@/modules/notification/application/service/delivery/send-next-delivery.service';
import { DispatchWorker } from '@/modules/notification/adapter/driving/worker/dispatch.worker';
import { MockMessageLookupAdapter } from '@/modules/notification/adapter/driven/mock-api/message/mock-message-lookup.adapter';
import { MockMessageSenderAdapter } from '@/modules/notification/adapter/driven/mock-api/message/mock-message-sender.adapter';
import { MockRecipientDirectoryAdapter } from '@/modules/notification/adapter/driven/mock-api/recipient/mock-recipient-directory.adapter';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/driven/persistence/drizzle-transaction.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/driven/persistence/notification-database.factory';
import { PostgresRateLimiterAdapter } from '@/modules/notification/adapter/driven/persistence/rate-limiter/postgres-rate-limiter.adapter';
import { RandomIdGeneratorAdapter } from '@/modules/notification/adapter/driven/system/random-id-generator.adapter';
import { RandomJitterSourceAdapter } from '@/modules/notification/adapter/driven/system/random-jitter-source.adapter';
import { RandomLeaseTokenGeneratorAdapter } from '@/modules/notification/adapter/driven/system/random-lease-token-generator.adapter';
import { SystemClockAdapter } from '@/modules/notification/adapter/driven/system/system-clock.adapter';
import { WorkerSettingsFactory } from '@/modules/notification/adapter/driven/config/worker-settings.factory';
import { WorkerSettings } from '@/modules/notification/adapter/driven/config/worker-settings.type';
import { ShutdownSignalPort } from '@/modules/notification/application/port/driven/for-checking-shutdown/shutdown-signal.port';
import { WorkerShutdownSignalAdapter } from '@/modules/notification/adapter/driven/process-state/worker-shutdown-signal.adapter';
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
      provide: WorkerShutdownSignalAdapter,
      useFactory: (): WorkerShutdownSignalAdapter => new WorkerShutdownSignalAdapter(),
    },
    { provide: ShutdownSignalPort, useExisting: WorkerShutdownSignalAdapter },
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
        WORKER_SETTINGS,
        ClockPort,
      ],
      useFactory: (
        transaction: TransactionPort,
        recipientDirectory: RecipientDirectoryPort,
        deliveryIdGenerator: DeliveryIdGeneratorPort,
        { deliverySettings }: WorkerSettings,
        clock: ClockPort,
      ): ExpandNextPageUseCase =>
        new ExpandNextPageService(
          transaction,
          recipientDirectory,
          deliveryIdGenerator,
          deliverySettings,
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
        WORKER_SETTINGS,
        JitterSourcePort,
        ShutdownSignalPort,
      ],
      useFactory: (
        transaction: TransactionPort,
        sendPermit: SendPermitPort,
        messageSender: MessageSenderPort,
        leaseTokenGenerator: LeaseTokenGeneratorPort,
        clock: ClockPort,
        { deliverySettings }: WorkerSettings,
        jitterSource: JitterSourcePort,
        shutdownSignal: ShutdownSignalPort,
      ): SendNextDeliveryUseCase =>
        new SendNextDeliveryService(
          transaction,
          sendPermit,
          messageSender,
          leaseTokenGenerator,
          clock,
          deliverySettings,
          jitterSource,
          shutdownSignal,
        ),
    },
    {
      provide: ReconcileNextDeliveryUseCase,
      inject: [TransactionPort, MessageLookupPort, ClockPort, WORKER_SETTINGS, JitterSourcePort],
      useFactory: (
        transaction: TransactionPort,
        messageLookup: MessageLookupPort,
        clock: ClockPort,
        { deliverySettings }: WorkerSettings,
        jitterSource: JitterSourcePort,
      ): ReconcileNextDeliveryUseCase =>
        new ReconcileNextDeliveryService(
          transaction,
          messageLookup,
          clock,
          deliverySettings,
          jitterSource,
        ),
    },
    {
      provide: RecoverExpiredLeaseUseCase,
      inject: [TransactionPort, ClockPort, WORKER_SETTINGS],
      useFactory: (
        transaction: TransactionPort,
        clock: ClockPort,
        { deliverySettings }: WorkerSettings,
      ): RecoverExpiredLeaseUseCase =>
        new RecoverExpiredLeaseService(transaction, clock, deliverySettings),
    },
    {
      provide: CompleteSettledAlarmsUseCase,
      inject: [TransactionPort, ClockPort],
      useFactory: (transaction: TransactionPort, clock: ClockPort): CompleteSettledAlarmsUseCase =>
        new CompleteSettledAlarmsService(
          transaction,
          new AlarmCompletionChecker(transaction, clock),
        ),
    },
    DispatchWorker,
  ],
})
export class NotificationWorkerModule {}
