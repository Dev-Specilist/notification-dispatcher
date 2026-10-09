import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/id-generator.port';
import { JitterSourcePort } from '@/modules/notification/application/port/driven/for-drawing-jitter/jitter-source.port';
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
import { SystemClockAdapter } from '@/modules/notification/adapter/driven/system/system-clock.adapter';
import { WorkerSettingsFactory } from '@/modules/notification/adapter/driven/config/worker-settings.factory';
import { WorkerSettings } from '@/modules/notification/adapter/driven/config/worker-settings.type';
import { ShutdownSignalPort } from '@/modules/notification/application/port/driven/for-checking-shutdown/shutdown-signal.port';
import { WorkerShutdownSignalAdapter } from '@/modules/notification/adapter/driven/process-state/worker-shutdown-signal.adapter';
import { TypedConfigService } from '@/shared/config/typed-config.service';

@Module({
  providers: [
    {
      provide: WorkerSettings,
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
    { provide: IdGeneratorPort, useClass: RandomIdGeneratorAdapter },
    { provide: JitterSourcePort, useClass: RandomJitterSourceAdapter },
    {
      provide: TransactionPort,
      inject: [Pool],
      useFactory: (pool: Pool): TransactionPort =>
        new DrizzleTransactionAdapter(NotificationDatabaseFactory.create(pool)),
    },
    {
      provide: SendPermitPort,
      inject: [Pool, WorkerSettings],
      useFactory: (pool: Pool, { rateLimiter }: WorkerSettings): SendPermitPort =>
        new PostgresRateLimiterAdapter(
          NotificationDatabaseFactory.create(pool),
          rateLimiter,
          PostgresRateLimiterAdapter.SERVER_CLOCK,
        ),
    },
    {
      provide: MessageSenderPort,
      inject: [WorkerSettings, WorkerShutdownSignalAdapter],
      useFactory: (
        { mockApi }: WorkerSettings,
        { outgoingRequestAbortSignal }: WorkerShutdownSignalAdapter,
      ): MessageSenderPort => new MockMessageSenderAdapter(mockApi, outgoingRequestAbortSignal),
    },
    {
      provide: MessageLookupPort,
      inject: [WorkerSettings, WorkerShutdownSignalAdapter],
      useFactory: (
        { mockApi }: WorkerSettings,
        { outgoingRequestAbortSignal }: WorkerShutdownSignalAdapter,
      ): MessageLookupPort => new MockMessageLookupAdapter(mockApi, outgoingRequestAbortSignal),
    },
    {
      provide: RecipientDirectoryPort,
      inject: [WorkerSettings, WorkerShutdownSignalAdapter],
      useFactory: (
        { recipientDirectory }: WorkerSettings,
        { outgoingRequestAbortSignal }: WorkerShutdownSignalAdapter,
      ): RecipientDirectoryPort =>
        new MockRecipientDirectoryAdapter(recipientDirectory, outgoingRequestAbortSignal),
    },
    {
      provide: ExpandNextPageUseCase,
      inject: [TransactionPort, RecipientDirectoryPort, IdGeneratorPort, WorkerSettings, ClockPort],
      useFactory: (
        transaction: TransactionPort,
        recipientDirectory: RecipientDirectoryPort,
        idGenerator: IdGeneratorPort,
        { deliverySettings }: WorkerSettings,
        clock: ClockPort,
      ): ExpandNextPageUseCase =>
        new ExpandNextPageService(
          transaction,
          recipientDirectory,
          idGenerator,
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
        IdGeneratorPort,
        ClockPort,
        WorkerSettings,
        JitterSourcePort,
        ShutdownSignalPort,
      ],
      useFactory: (
        transaction: TransactionPort,
        sendPermit: SendPermitPort,
        messageSender: MessageSenderPort,
        idGenerator: IdGeneratorPort,
        clock: ClockPort,
        { deliverySettings }: WorkerSettings,
        jitterSource: JitterSourcePort,
        shutdownSignal: ShutdownSignalPort,
      ): SendNextDeliveryUseCase =>
        new SendNextDeliveryService(
          transaction,
          sendPermit,
          messageSender,
          idGenerator,
          clock,
          deliverySettings,
          jitterSource,
          shutdownSignal,
        ),
    },
    {
      provide: ReconcileNextDeliveryUseCase,
      inject: [TransactionPort, MessageLookupPort, ClockPort, WorkerSettings, JitterSourcePort],
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
      inject: [TransactionPort, ClockPort, WorkerSettings],
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
