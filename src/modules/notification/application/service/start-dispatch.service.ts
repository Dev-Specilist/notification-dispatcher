import {
  AlarmId,
  AlarmSnapshot,
  AlarmTransition,
  AlarmTransitioned,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/out/id-generator.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/out/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/unit-of-work.type';
import { StartDispatchResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { StartDispatchUseCase } from '@/modules/notification/application/port/in/start-dispatch.use-case';

export class StartDispatchService implements StartDispatchUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  execute(alarmId: AlarmId): Promise<StartDispatchResult> {
    const now: Date = this.clock.now();
    return this.unitOfWork.run(
      async ({
        alarmRepository,
        deliveryRepository,
        expansionJobRepository,
      }: TransactionRepositories): Promise<StartDispatchResult> => {
        const lookup: AlarmLookup = await alarmRepository.findByIdForUpdate(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
        }
        const transition: AlarmTransition = lookup.alarm.startDispatch(now);
        if (transition.kind === 'conflict') {
          return transition;
        }
        const { alarm }: AlarmTransitioned = transition;
        await alarmRepository.save(alarm);
        const snapshot: AlarmSnapshot = alarm.snapshot();
        if (snapshot.kind === 'URGENT') {
          await deliveryRepository.saveAll(
            snapshot.target.recipientIds.map((recipientId: RecipientId): Delivery =>
              Delivery.create(
                { id: this.idGenerator.deliveryId(), alarmId, recipientId, priority: 'URGENT' },
                now,
              ),
            ),
          );
        } else {
          await expansionJobRepository.enqueue(alarmId, now);
        }
        return { kind: 'dispatched', alarm };
      },
    );
  }
}
