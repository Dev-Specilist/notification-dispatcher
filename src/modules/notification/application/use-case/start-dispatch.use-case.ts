import { Injectable } from '@nestjs/common';
import {
  AlarmId,
  AlarmSnapshot,
  AlarmTransition,
  AlarmTransitioned,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { StartDispatchResult } from '@/modules/notification/application/use-case/alarm-result.type';

@Injectable()
export class StartDispatchUseCase {
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
        const lookup: AlarmLookup = await alarmRepository.findById(alarmId);
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
