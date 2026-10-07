import { Injectable } from '@nestjs/common';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import {
  ClaimableFound,
  ClaimableLookup,
  LeasedSave,
} from '@/modules/notification/application/port/delivery-repository.type';
import { DispatchSettingsPort } from '@/modules/notification/application/port/dispatch-settings.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/lease-token-generator.port';
import { MessageSenderPort } from '@/modules/notification/application/port/message-sender.port';
import { SendOutcome } from '@/modules/notification/application/port/message-sender.type';
import { SendPermitPort } from '@/modules/notification/application/port/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/send-permit.type';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { SendAttempt } from '@/modules/notification/application/use-case/send-next-delivery.type';

interface RequestReady {
  readonly kind: 'ready';
  readonly delivery: Delivery;
  readonly body: string;
}

type ClaimStep = SendAttempt | RequestReady;

@Injectable()
export class SendNextDeliveryUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly sendPermit: SendPermitPort,
    private readonly messageSender: MessageSenderPort,
    private readonly leaseTokenGenerator: LeaseTokenGeneratorPort,
    private readonly clock: ClockPort,
    private readonly settings: DispatchSettingsPort,
  ) {}

  async execute(): Promise<SendAttempt> {
    const permit: SendPermit = await this.sendPermit.acquire();
    if (permit.kind === 'denied') {
      return { kind: 'no-permit' };
    }
    const token: LeaseToken = this.leaseTokenGenerator.next();
    const step: ClaimStep = await this.claimNext(token);
    if (step.kind !== 'ready') {
      return step;
    }
    const { alarmId, recipientId, id }: DeliverySnapshot = step.delivery.snapshot();
    const outcome: SendOutcome = await this.messageSender.send({
      alarmId,
      recipientId,
      body: step.body,
      clientRef: id,
    });
    return this.recordOutcome(step.delivery, token, outcome);
  }

  private claimNext(token: LeaseToken): Promise<ClaimStep> {
    return this.unitOfWork.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: TransactionRepositories): Promise<ClaimStep> => {
        const lookupAt: Date = this.clock.now();
        const next: ClaimableLookup = await deliveryRepository.findNextClaimable(lookupAt);
        if (next.kind === 'none') {
          return { kind: 'idle' };
        }
        const { delivery }: ClaimableFound = next;
        const { id, alarmId }: DeliverySnapshot = delivery.snapshot();
        const alarm: AlarmLookup = await alarmRepository.findById(alarmId);
        const claimedAt: Date = this.clock.now();
        if (alarm.kind === 'missing' || alarm.alarm.snapshot().state.status === 'CANCELLED') {
          await deliveryRepository.saveAll([
            SendNextDeliveryUseCase.transitioned(delivery.cancel(claimedAt)),
          ]);
          return { kind: 'skipped', deliveryId: id };
        }
        const claimed: Delivery = SendNextDeliveryUseCase.transitioned(
          delivery.claim(token, claimedAt, this.settings.leaseMs),
        );
        const started: DeliveryTransition = claimed.startRequest(
          token,
          claimedAt,
          this.settings.maxRequestMs,
        );
        if (started.kind === 'released') {
          await deliveryRepository.saveAll([started.delivery]);
          return { kind: 'released', deliveryId: id };
        }
        const inFlight: Delivery = SendNextDeliveryUseCase.transitioned(started);
        await deliveryRepository.saveAll([inFlight]);
        return { kind: 'ready', delivery: inFlight, body: alarm.alarm.snapshot().body };
      },
    );
  }

  private recordOutcome(
    delivery: Delivery,
    token: LeaseToken,
    outcome: SendOutcome,
  ): Promise<SendAttempt> {
    const now: Date = this.clock.now();
    const { id }: DeliverySnapshot = delivery.snapshot();
    const settled: Delivery = SendNextDeliveryUseCase.transitioned(
      delivery.recordAccepted(token, outcome.messageId, now),
    );
    return this.unitOfWork.run(
      async ({ deliveryRepository }: TransactionRepositories): Promise<SendAttempt> => {
        const saved: LeasedSave = await deliveryRepository.saveLeased(settled, token);
        return saved.kind === 'saved'
          ? { kind: 'sent', deliveryId: id }
          : { kind: 'lease-lost', deliveryId: id };
      },
    );
  }

  private static transitioned(transition: DeliveryTransition): Delivery {
    if (transition.kind === 'rejected') {
      throw new Error(`delivery transition was rejected: ${transition.reason}`);
    }
    return transition.delivery;
  }
}
