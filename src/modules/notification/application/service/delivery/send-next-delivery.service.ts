import {
  AlarmFound,
  AlarmLookup,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import {
  CandidateFound,
  DeliveryCandidate,
  LeasedSave,
} from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';
import { DispatchSettings } from '@/modules/notification/application/service/delivery/delivery-settings.type';
import { ShutdownSignalPort } from '@/modules/notification/application/port/driven/for-checking-shutdown/shutdown-signal.port';
import { JitterSourcePort } from '@/modules/notification/application/port/driven/for-drawing-jitter/jitter-source.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/lease-token-generator.port';
import { MessageSenderPort } from '@/modules/notification/application/port/driven/for-sending-messages/message-sender.port';
import { SendOutcome } from '@/modules/notification/application/port/driven/for-sending-messages/message-sender.type';
import { SendPermitPort } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { SendAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.type';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.use-case';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';

interface SendNextDeliveryRepositories {
  readonly alarmRepository: Pick<AlarmRepositoryPort, 'findById'>;
  readonly deliveryRepository: Pick<
    DeliveryRepositoryPort,
    'findNextClaimable' | 'saveAll' | 'saveLeased'
  >;
}

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
    private readonly settings: Readonly<DispatchSettings>,
    private readonly jitterSource: JitterSourcePort,
    private readonly shutdownSignal: ShutdownSignalPort,
  ) {}

  async execute(): Promise<SendAttempt> {
    const permit: SendPermit = await this.sendPermit.acquire();
    if (permit.kind === 'denied') {
      return { kind: 'no-permit' };
    }
    if (this.shutdownSignal.isRequested()) {
      return { kind: 'stopped' };
    }
    const token: LeaseToken = this.leaseTokenGenerator.next();
    const step: ClaimStep = await this.claimNext(token);
    if (step.kind !== 'ready') {
      return step;
    }
    const { alarmId, recipientId, id }: DeliverySnapshot = step.delivery.snapshot();
    if (!step.delivery.hasLeaseTimeFor(this.clock.now(), this.settings.maxRequestMs)) {
      return { kind: 'lease-too-short', deliveryId: id };
    }
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
      }: SendNextDeliveryRepositories): Promise<ClaimStep> => {
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
    if (outcome.kind === 'rate-limited' || outcome.kind === 'unreachable') {
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
      }: SendNextDeliveryRepositories): Promise<SendAttempt> => {
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
      case 'unreachable':
        return delivery.recordUnreachable(token, now, outcome.retryAfterMs);
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
