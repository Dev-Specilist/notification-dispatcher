import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.use-case';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.use-case';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.use-case';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.use-case';
import { CompleteSettledAlarmsService } from '@/modules/notification/application/service/completion/complete-settled-alarms.service';
import { ExpandNextPageService } from '@/modules/notification/application/service/expansion/expand-next-page.service';
import { ReconcileNextDeliveryService } from '@/modules/notification/application/service/delivery/reconcile-next-delivery.service';
import { RecoverExpiredLeaseService } from '@/modules/notification/application/service/delivery/recover-expired-lease.service';
import { SendNextDeliveryService } from '@/modules/notification/application/service/delivery/send-next-delivery.service';
import { DispatchWorker } from '@/modules/notification/adapter/driving/worker/dispatch.worker';
import { NotificationWorkerModule } from '@/modules/notification/notification-worker.module';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { DatabaseModule } from '@/shared/database/database.module';

const compile = (): Promise<TestingModule> =>
  Test.createTestingModule({
    imports: [
      TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3001))),
      DatabaseModule,
      NotificationWorkerModule,
    ],
  }).compile();

describe('NotificationWorkerModule', () => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('워커 유스케이스를 서비스로 조립하고 발송 워커를 만든다', async (): Promise<void> => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:secret@localhost:5432/notification');
    const moduleRef: TestingModule = await compile();

    expect(moduleRef.get(ExpandNextPageUseCase)).toBeInstanceOf(ExpandNextPageService);
    expect(moduleRef.get(SendNextDeliveryUseCase)).toBeInstanceOf(SendNextDeliveryService);
    expect(moduleRef.get(ReconcileNextDeliveryUseCase)).toBeInstanceOf(
      ReconcileNextDeliveryService,
    );
    expect(moduleRef.get(RecoverExpiredLeaseUseCase)).toBeInstanceOf(RecoverExpiredLeaseService);
    expect(moduleRef.get(CompleteSettledAlarmsUseCase)).toBeInstanceOf(
      CompleteSettledAlarmsService,
    );
    expect(moduleRef.get(DispatchWorker)).toBeInstanceOf(DispatchWorker);
    await moduleRef.close();
  });

  it('워커 설정이 서로 맞지 않으면 기동할 때 실패한다', async (): Promise<void> => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:secret@localhost:5432/notification');
    vi.stubEnv('RATE_LIMIT_INTERVAL_MS', '19');

    await expect(compile()).rejects.toThrow('RATE_LIMIT_INTERVAL_MS(19) must be at least 20');
  });
});
