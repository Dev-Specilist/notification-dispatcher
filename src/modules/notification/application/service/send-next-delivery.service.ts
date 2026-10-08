import {
  AlarmFound,
  AlarmLookup,
} from '@/modules/notification/application/port/out/alarm-repository.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import {
  CandidateFound,
  DeliveryCandidate,
  LeasedSave,
} from '@/modules/notification/application/port/out/delivery-repository.type';
import { DispatchSettingsPort } from '@/modules/notification/application/port/out/dispatch-settings.port';
import { JitterSourcePort } from '@/modules/notification/application/port/out/jitter-source.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/out/lease-token-generator.port';
import { MessageSenderPort } from '@/modules/notification/application/port/out/message-sender.port';
import { SendOutcome } from '@/modules/notification/application/port/out/message-sender.type';
import { SendPermitPort } from '@/modules/notification/application/port/out/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/out/send-permit.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { SendAttempt } from '@/modules/notification/application/port/in/send-next-delivery.type';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/in/send-next-delivery.use-case';

interface RequestReady {
  readonly kind: 'ready';
  readonly delivery: Delivery;
  readonly body: string;
}

type ClaimStep = SendAttempt | RequestReady;

export class SendNextDeliveryService implements SendNextDeliveryUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly sendPermit: SendPermitPort,
    private readonly messageSender: MessageSenderPort,
    private readonly leaseTokenGenerator: LeaseTokenGeneratorPort,
    private readonly clock: ClockPort,
    private readonly settings: DispatchSettingsPort,
    private readonly jitterSource: JitterSourcePort,
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
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: TransactionRepositories): Promise<ClaimStep> => {
        const lookupAt: Date = this.clock.now();
        const next: DeliveryCandidate = await deliveryRepository.findNextClaimable(lookupAt);
        if (next.kind === 'none') {
          return { kind: 'idle' };
        }
        const { delivery }: CandidateFound = next;
        const { id, alarmId }: DeliverySnapshot = delivery.snapshot();
        const alarm: AlarmLookup = await alarmRepository.findById(alarmId);
        const claimedAt: Date = this.clock.now();
        if (!SendNextDeliveryService.isActive(alarm)) {
          await deliveryRepository.saveAll([
            SendNextDeliveryService.transitioned(delivery.cancel(claimedAt)),
          ]);
          return { kind: 'skipped', deliveryId: id };
        }
        const claimed: Delivery = SendNextDeliveryService.transitioned(
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
        const inFlight: Delivery = SendNextDeliveryService.transitioned(started);
        await deliveryRepository.saveAll([inFlight]);
        return { kind: 'ready', delivery: inFlight, body: alarm.alarm.snapshot().body };
      },
    );
  }

  private async recordOutcome(
    delivery: Delivery,
    token: LeaseToken,
    outcome: SendOutcome,
  ): Promise<SendAttempt> {
    if (outcome.kind === 'rate-limited') {
      await this.sendPermit.holdFor(outcome.retryAfterMs);
    }
    const now: Date = this.clock.now();
    const settled: Delivery = SendNextDeliveryService.transitioned(
      this.applyOutcome(delivery, token, outcome, now),
    );
    const { id, alarmId }: DeliverySnapshot = delivery.snapshot();
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: TransactionRepositories): Promise<SendAttempt> => {
        const alarm: AlarmLookup = await alarmRepository.findById(alarmId);
        const recorded: Delivery =
          !SendNextDeliveryService.isActive(alarm) &&
          settled.snapshot().state.status === 'RETRY_WAIT'
            ? SendNextDeliveryService.transitioned(settled.cancel(now))
            : settled;
        const saved: LeasedSave = await deliveryRepository.saveLeased(recorded, token);
        return saved.kind === 'saved'
          ? { kind: 'recorded', deliveryId: id, outcome: outcome.kind }
          : { kind: 'lease-lost', deliveryId: id };
      },
    );
  }

  private applyOutcome(
    delivery: Delivery,
    token: LeaseToken,
    outcome: SendOutcome,
    now: Readonly<Date>,
  ): DeliveryTransition {
    switch (outcome.kind) {
      case 'accepted':
        return delivery.recordAccepted(token, outcome.messageId, now);
      case 'permanent-failure':
        return delivery.recordPermanentFailure(token, outcome.code);
      case 'transient-failure':
        return delivery.recordTransientFailure(
          token,
          now,
          this.settings.retryPolicy,
          this.jitterSource.next(),
        );
      case 'rate-limited':
        return delivery.recordRateLimited(token, now, outcome.retryAfterMs);
      case 'indeterminate':
        break;
    }
    return delivery.recordUnknown(token, now, this.settings.reconcileDelayMs);
  }

  private static isActive(alarm: AlarmLookup): alarm is AlarmFound {
    return alarm.kind === 'found' && alarm.alarm.snapshot().state.status !== 'CANCELLED';
  }

  private static transitioned(transition: DeliveryTransition): Delivery {
    if (transition.kind === 'rejected') {
      throw new Error(`delivery transition was rejected: ${transition.reason}`);
    }
    return transition.delivery;
  }
}
