import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmId,
  AlarmTransition,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  DeliveryId,
  DeliveryPriority,
  DeliverySnapshot,
  DeliveryTransition,
  JitterRatio,
  LeaseToken,
  MessageId,
  RetryAfterMs,
} from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';
import { DeliveryCandidate } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';

interface DeliveryInspection {
  findByAlarmId(alarmId: AlarmId): Promise<ReadonlyArray<Delivery>>;
}

type ContractDeliveryRepository = DeliveryRepositoryPort & DeliveryInspection;

interface ContractRepositories {
  readonly alarmRepository: AlarmRepositoryPort;
  readonly deliveryRepository: ContractDeliveryRepository;
}

interface Scenario extends ContractRepositories {
  readonly owner: AlarmId;
}

type RepositoriesFactory = () => Promise<ContractRepositories>;

type StateCase = Readonly<[string, (delivery: Delivery) => Delivery]>;

type StatusSeed = Readonly<[advance: (delivery: Delivery) => Delivery, count: number]>;

type RecipientStatus = Readonly<[string, string]>;

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const LATER_CREATED_ISO: string = '2026-10-08T09:00:01.000Z';
const CLAIMED_ISO: string = '2026-10-08T09:01:00.000Z';
const SETTLED_ISO: string = '2026-10-08T09:01:05.000Z';
const NOW_ISO: string = '2026-10-08T09:02:00.000Z';
const TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';
const OTHER_TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7cbb';

export class DeliveryRepositoryContract {
  static verify(createRepositories: RepositoriesFactory): void {
    it('DB-07 같은 (알림, 수신자) / Delivery를 두 번 만든다 → unique 제약으로 하나만 남는다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);

      await deliveryRepository.insertMissing([
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      ]);
      await deliveryRepository.insertMissing([
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
        DeliveryRepositoryContract.pending(owner, 'u_000002'),
        DeliveryRepositoryContract.pending(owner, 'u_000002'),
      ]);

      expect(await DeliveryRepositoryContract.statuses(deliveryRepository, owner)).toEqual([
        ['u_000001', 'PENDING'],
        ['u_000002', 'PENDING'],
      ]);
    });

    it('DB-07 같은 (알림, 수신자)를 다른 id로 저장하면 거부한다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      await deliveryRepository.saveAll([DeliveryRepositoryContract.pending(owner, 'u_000001')]);

      await expect(
        deliveryRepository.saveAll([DeliveryRepositoryContract.pending(owner, 'u_000001')]),
      ).rejects.toBeInstanceOf(Error);
      expect(await DeliveryRepositoryContract.statuses(deliveryRepository, owner)).toEqual([
        ['u_000001', 'PENDING'],
      ]);
    });

    it('DB-07 한 묶음 안에 같은 (알림, 수신자)가 다른 id로 두 번 있으면 아무것도 저장하지 않고 거부한다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);

      await expect(
        deliveryRepository.saveAll([
          DeliveryRepositoryContract.pending(owner, 'u_000002'),
          DeliveryRepositoryContract.pending(owner, 'u_000001'),
          DeliveryRepositoryContract.pending(owner, 'u_000001'),
        ]),
      ).rejects.toBeInstanceOf(Error);
      expect(await DeliveryRepositoryContract.statuses(deliveryRepository, owner)).toEqual([]);
    });

    it.each<StateCase>([
      ['PENDING', (delivery: Delivery): Delivery => delivery],
      [
        'IN_FLIGHT(요청 전)',
        (delivery: Delivery): Delivery => DeliveryRepositoryContract.claim(delivery),
      ],
      [
        'IN_FLIGHT(요청 후)',
        (delivery: Delivery): Delivery => DeliveryRepositoryContract.start(delivery),
      ],
      [
        'RETRY_WAIT',
        (delivery: Delivery): Delivery => DeliveryRepositoryContract.retryWaiting(delivery),
      ],
      [
        'RETRY_WAIT(연결 실패)',
        (delivery: Delivery): Delivery => DeliveryRepositoryContract.unreachableWaiting(delivery),
      ],
      ['UNKNOWN', (delivery: Delivery): Delivery => DeliveryRepositoryContract.timedOut(delivery)],
      ['SENT', (delivery: Delivery): Delivery => DeliveryRepositoryContract.sent(delivery)],
      ['FAILED', (delivery: Delivery): Delivery => DeliveryRepositoryContract.failed(delivery)],
      [
        'UNCONFIRMED',
        (delivery: Delivery): Delivery => DeliveryRepositoryContract.unconfirmed(delivery),
      ],
      [
        'CANCELLED',
        (delivery: Delivery): Delivery => DeliveryRepositoryContract.cancelled(delivery),
      ],
    ])(
      'DB-07 %s Delivery를 저장하면 상태와 시각이 그대로 복원된다',
      async (_status: string, advance: (delivery: Delivery) => Delivery): Promise<void> => {
        const { deliveryRepository, owner }: Scenario =
          await DeliveryRepositoryContract.scenario(createRepositories);
        const delivery: Delivery = advance(DeliveryRepositoryContract.pending(owner, 'u_000001'));

        await deliveryRepository.saveAll([delivery]);

        expect(await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).toEqual([
          delivery.snapshot(),
        ]);
      },
    );

    it('DB-07 다시 claim해 저장하면 이전 시도의 요청 시작 기록이 남지 않는다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const started: Delivery = DeliveryRepositoryContract.start(
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      );
      const retrying: Delivery = DeliveryRepositoryContract.transitioned(
        started.recordRateLimited(
          DeliveryRepositoryContract.token(TOKEN),
          new Date(SETTLED_ISO),
          DeliveryRepositoryContract.retryAfter(1_000),
        ),
      );
      const reclaimed: Delivery = DeliveryRepositoryContract.transitioned(
        retrying.claim(
          DeliveryRepositoryContract.token(OTHER_TOKEN),
          new Date(NOW_ISO),
          DeliveryRepositoryContract.duration(60_000),
        ),
      );

      await deliveryRepository.saveAll([started]);
      await deliveryRepository.saveAll([retrying]);
      await deliveryRepository.saveAll([reclaimed]);

      expect(await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).toEqual([
        reclaimed.snapshot(),
      ]);
    });

    it('DB-07 알림별 조회는 그 알림의 Delivery만 생성 시각과 id 순서로 돌려준다', async (): Promise<void> => {
      const { alarmRepository, deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const other: AlarmId = await DeliveryRepositoryContract.storedAlarm(alarmRepository);

      await deliveryRepository.saveAll([
        DeliveryRepositoryContract.pending(owner, 'u_000003', 'BULK', LATER_CREATED_ISO),
        DeliveryRepositoryContract.pending(other, 'u_000009'),
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      ]);

      expect(
        (await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).map(
          ({ recipientId }: DeliverySnapshot): string => recipientId,
        ),
      ).toEqual(['u_000001', 'u_000003']);
    });

    it('DB-07 생성 시각이 같은 Delivery는 id 순서로 돌려준다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const deliveries: ReadonlyArray<Delivery> = [
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
        DeliveryRepositoryContract.pending(owner, 'u_000002'),
        DeliveryRepositoryContract.pending(owner, 'u_000003'),
      ];
      await deliveryRepository.saveAll(deliveries);

      expect(
        (await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).map(
          ({ id: deliveryId }: DeliverySnapshot): string => deliveryId,
        ),
      ).toEqual(
        deliveries
          .map((delivery: Delivery): string => delivery.snapshot().id)
          .toSorted((left: string, right: string): number => (left < right ? -1 : 1)),
      );
    });

    it('UC-13 대기 중인 Delivery만 일괄 취소하고 처리 중인 건과 다른 알림의 건은 그대로 둔다', async (): Promise<void> => {
      const { alarmRepository, deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const other: AlarmId = await DeliveryRepositoryContract.storedAlarm(alarmRepository);
      await deliveryRepository.saveAll([
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
        DeliveryRepositoryContract.claim(DeliveryRepositoryContract.pending(owner, 'u_000002')),
        DeliveryRepositoryContract.transitioned(
          DeliveryRepositoryContract.start(
            DeliveryRepositoryContract.pending(owner, 'u_000004'),
          ).recordRateLimited(
            DeliveryRepositoryContract.token(TOKEN),
            new Date(SETTLED_ISO),
            DeliveryRepositoryContract.retryAfter(1_000),
          ),
        ),
        DeliveryRepositoryContract.pending(other, 'u_000003'),
      ]);

      await deliveryRepository.cancelWaiting(owner, new Date(NOW_ISO));

      expect(await DeliveryRepositoryContract.statuses(deliveryRepository, owner)).toEqual([
        ['u_000001', 'CANCELLED'],
        ['u_000002', 'IN_FLIGHT'],
        ['u_000004', 'CANCELLED'],
      ]);
      expect(await DeliveryRepositoryContract.statuses(deliveryRepository, other)).toEqual([
        ['u_000003', 'PENDING'],
      ]);
    });

    it('UC-12 미종결 Delivery 수는 SENT·FAILED·UNCONFIRMED·CANCELLED를 뺀 건수다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      await deliveryRepository.saveAll([
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
        DeliveryRepositoryContract.timedOut(DeliveryRepositoryContract.pending(owner, 'u_000002')),
        DeliveryRepositoryContract.transitioned(
          DeliveryRepositoryContract.pending(owner, 'u_000003').cancel(new Date(SETTLED_ISO)),
        ),
      ]);

      expect(await deliveryRepository.countUnsettled(owner)).toBe(2);
    });

    it('DB-16 여러 상태의 Delivery를 가진 알림과 다른 알림 / 알림의 상태별 Delivery 수를 조회한다 → 그 알림의 건만 상태마다 세고, 건이 없는 상태는 0이다', async (): Promise<void> => {
      const { alarmRepository, deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const other: AlarmId = await DeliveryRepositoryContract.storedAlarm(alarmRepository);
      const seeds: ReadonlyArray<StatusSeed> = [
        [(delivery: Delivery): Delivery => delivery, 1],
        [(delivery: Delivery): Delivery => DeliveryRepositoryContract.claim(delivery), 2],
        [(delivery: Delivery): Delivery => DeliveryRepositoryContract.retryWaiting(delivery), 3],
        [(delivery: Delivery): Delivery => DeliveryRepositoryContract.timedOut(delivery), 4],
        [(delivery: Delivery): Delivery => DeliveryRepositoryContract.sent(delivery), 5],
        [(delivery: Delivery): Delivery => DeliveryRepositoryContract.failed(delivery), 6],
        [(delivery: Delivery): Delivery => DeliveryRepositoryContract.unconfirmed(delivery), 7],
        [(delivery: Delivery): Delivery => DeliveryRepositoryContract.cancelled(delivery), 8],
      ];
      await deliveryRepository.saveAll([
        ...seeds.flatMap(
          ([advance, count]: StatusSeed, seedIndex: number): ReadonlyArray<Delivery> =>
            Array.from({ length: count }, (_: number, itemIndex: number): Delivery =>
              advance(DeliveryRepositoryContract.pending(owner, `u_${seedIndex}_${itemIndex}`)),
            ),
        ),
        DeliveryRepositoryContract.pending(other, 'u_0_0'),
      ]);

      expect(await deliveryRepository.countByStatus(owner)).toEqual({
        PENDING: 1,
        IN_FLIGHT: 2,
        RETRY_WAIT: 3,
        UNKNOWN: 4,
        SENT: 5,
        FAILED: 6,
        UNCONFIRMED: 7,
        CANCELLED: 8,
      });
    });

    it('DB-16 Delivery가 하나도 없는 알림은 모든 상태의 수가 0이다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);

      expect(await deliveryRepository.countByStatus(owner)).toEqual({
        PENDING: 0,
        IN_FLIGHT: 0,
        RETRY_WAIT: 0,
        UNKNOWN: 0,
        SENT: 0,
        FAILED: 0,
        UNCONFIRMED: 0,
        CANCELLED: 0,
      });
    });

    it('UC-09 claim 대상은 발송 가능한 건 중 긴급 우선, 같으면 먼저 만든 건이다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const urgent: Delivery = DeliveryRepositoryContract.pending(
        owner,
        'u_000003',
        'URGENT',
        LATER_CREATED_ISO,
      );
      await deliveryRepository.saveAll([
        DeliveryRepositoryContract.pending(owner, 'u_000001', 'BULK', CREATED_ISO),
        urgent,
        DeliveryRepositoryContract.claim(
          DeliveryRepositoryContract.pending(owner, 'u_000002', 'URGENT', CREATED_ISO),
        ),
      ]);

      expect(
        DeliveryRepositoryContract.candidateId(
          await deliveryRepository.findNextClaimable(new Date(NOW_ISO)),
        ),
      ).toBe(urgent.snapshot().id);
    });

    it('DB-08 발송 가능한 긴급 Delivery와 대량 Delivery가 함께 대기 중 / 워커가 claim한다 → 긴급 Delivery가 먼저 나오고, RETRY_WAIT(재시도 시각 전) 긴급 Delivery는 대량 Delivery의 claim을 막지 않는다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const retryingUrgent: Delivery = DeliveryRepositoryContract.transitioned(
        DeliveryRepositoryContract.start(
          DeliveryRepositoryContract.pending(owner, 'u_000001', 'URGENT'),
        ).recordRateLimited(
          DeliveryRepositoryContract.token(TOKEN),
          new Date(SETTLED_ISO),
          DeliveryRepositoryContract.retryAfter(60_000),
        ),
      );
      const bulk: Delivery = DeliveryRepositoryContract.pending(
        owner,
        'u_000002',
        'BULK',
        LATER_CREATED_ISO,
      );
      await deliveryRepository.saveAll([retryingUrgent, bulk]);

      expect(
        DeliveryRepositoryContract.candidateId(
          await deliveryRepository.findNextClaimable(new Date(NOW_ISO)),
        ),
      ).toBe(bulk.snapshot().id);
      expect(
        DeliveryRepositoryContract.candidateId(
          await deliveryRepository.findNextClaimable(new Date('2026-10-08T09:02:05.000Z')),
        ),
      ).toBe(retryingUrgent.snapshot().id);
    });

    it('DB-10 다른 leaseToken으로 결과 저장 / 갱신 쿼리 → 0행이 갱신되고 기존 상태가 유지된다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const pending: Delivery = DeliveryRepositoryContract.pending(owner, 'u_000001');
      const reclaimed: Delivery = DeliveryRepositoryContract.transitioned(
        pending.claim(
          DeliveryRepositoryContract.token(OTHER_TOKEN),
          new Date(CLAIMED_ISO),
          DeliveryRepositoryContract.duration(60_000),
        ),
      );
      await deliveryRepository.saveAll([reclaimed]);
      const lateResult: Delivery = DeliveryRepositoryContract.transitioned(
        DeliveryRepositoryContract.start(pending).recordAccepted(
          DeliveryRepositoryContract.token(TOKEN),
          DeliveryRepositoryContract.messageId('m_1'),
          new Date(SETTLED_ISO),
        ),
      );

      expect(
        await deliveryRepository.saveLeased(lateResult, DeliveryRepositoryContract.token(TOKEN)),
      ).toEqual({ kind: 'lease-lost' });
      expect(await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).toEqual([
        reclaimed.snapshot(),
      ]);
    });

    it('DB-10 같은 leaseToken의 IN_FLIGHT 건이면 결과를 저장한다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const started: Delivery = DeliveryRepositoryContract.start(
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      );
      await deliveryRepository.saveAll([started]);
      const settled: Delivery = DeliveryRepositoryContract.transitioned(
        started.recordAccepted(
          DeliveryRepositoryContract.token(TOKEN),
          DeliveryRepositoryContract.messageId('m_1'),
          new Date(SETTLED_ISO),
        ),
      );

      expect(
        await deliveryRepository.saveLeased(settled, DeliveryRepositoryContract.token(TOKEN)),
      ).toEqual({ kind: 'saved' });
      expect(await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).toEqual([
        settled.snapshot(),
      ]);
    });

    it('DB-10 저장소에 없는 Delivery의 결과는 저장하지 않는다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const started: Delivery = DeliveryRepositoryContract.start(
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      );

      expect(
        await deliveryRepository.saveLeased(started, DeliveryRepositoryContract.token(TOKEN)),
      ).toEqual({ kind: 'lease-lost' });
      expect(await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).toEqual([]);
    });

    it('UC-14 reconcile 대상은 reconcile 가능 시각이 지난 UNKNOWN 중 가장 이른 건이다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const early: Delivery = DeliveryRepositoryContract.timedOut(
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
        '2026-10-08T09:01:00.000Z',
      );
      const late: Delivery = DeliveryRepositoryContract.timedOut(
        DeliveryRepositoryContract.pending(owner, 'u_000002'),
        '2026-10-08T09:01:30.000Z',
      );
      await deliveryRepository.saveAll([late, early]);

      expect(
        await deliveryRepository.findNextReconcilable(new Date('2026-10-08T09:01:34.999Z')),
      ).toEqual({ kind: 'none' });
      expect(
        DeliveryRepositoryContract.candidateId(
          await deliveryRepository.findNextReconcilable(new Date('2026-10-08T09:03:00.000Z')),
        ),
      ).toBe(early.snapshot().id);
    });

    it('DB-14 같은 UNKNOWN Delivery / 두 워커가 reconcile 결과를 차례로 저장한다 → 먼저 저장한 결과만 반영되고 늦은 결과는 저장되지 않는다 (조건부 갱신)', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const uncertain: Delivery = DeliveryRepositoryContract.timedOut(
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      );
      await deliveryRepository.saveAll([uncertain]);
      const afterLookupFailure: Delivery = DeliveryRepositoryContract.transitioned(
        uncertain.recordLookupFailure(
          new Date(NOW_ISO),
          DeliveryRepositoryContract.retryPolicy(),
          DeliveryRepositoryContract.zeroJitter(),
        ),
      );
      const late: Delivery = DeliveryRepositoryContract.transitioned(
        uncertain.reconcileFound([
          { messageId: DeliveryRepositoryContract.messageId('m_1'), sentAt: new Date(SETTLED_ISO) },
        ]),
      );

      expect(await deliveryRepository.saveReconciled(afterLookupFailure, uncertain)).toEqual({
        kind: 'saved',
      });
      expect(await deliveryRepository.saveReconciled(late, uncertain)).toEqual({
        kind: 'superseded',
      });
      expect(await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).toEqual([
        afterLookupFailure.snapshot(),
      ]);
    });

    it('DB-14 먼저 SENT로 확정된 뒤 들어온 늦은 reconcile 결과는 저장하지 않는다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const uncertain: Delivery = DeliveryRepositoryContract.timedOut(
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      );
      await deliveryRepository.saveAll([uncertain]);
      const sent: Delivery = DeliveryRepositoryContract.transitioned(
        uncertain.reconcileFound([
          { messageId: DeliveryRepositoryContract.messageId('m_1'), sentAt: new Date(SETTLED_ISO) },
        ]),
      );
      await deliveryRepository.saveReconciled(sent, uncertain);
      const lateRetry: Delivery = DeliveryRepositoryContract.transitioned(
        uncertain.reconcileNotFound(
          new Date('2026-10-08T09:03:00.000Z'),
          DeliveryRepositoryContract.retryPolicy(),
          DeliveryRepositoryContract.zeroJitter(),
        ),
      );

      expect(await deliveryRepository.saveReconciled(lateRetry, uncertain)).toEqual({
        kind: 'superseded',
      });
      expect(await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).toEqual([
        sent.snapshot(),
      ]);
    });

    it('DB-14 reconcile 시각이 같아도 조회 실패 횟수가 다르면 다른 버전으로 보고 저장하지 않는다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const uncertain: Delivery = DeliveryRepositoryContract.timedOut(
        DeliveryRepositoryContract.pending(owner, 'u_000001'),
      );
      const { state }: DeliverySnapshot = uncertain.snapshot();
      if (state.status !== 'UNKNOWN') {
        throw new Error('contract fixture must be UNKNOWN');
      }
      const sameTimeAnotherFailure: Delivery = DeliveryRepositoryContract.transitioned(
        uncertain.recordLookupFailure(
          new Date(state.reconcileAt.getTime() - 500),
          DeliveryRepositoryContract.retryPolicy(),
          DeliveryRepositoryContract.zeroJitter(),
        ),
      );
      await deliveryRepository.saveAll([sameTimeAnotherFailure]);
      const late: Delivery = DeliveryRepositoryContract.transitioned(
        uncertain.reconcileFound([
          { messageId: DeliveryRepositoryContract.messageId('m_1'), sentAt: new Date(SETTLED_ISO) },
        ]),
      );

      expect(await deliveryRepository.saveReconciled(late, uncertain)).toEqual({
        kind: 'superseded',
      });
    });

    it('DB-09 lease가 만료된 IN_FLIGHT Delivery / 복구 쿼리 → UNKNOWN으로 바뀌고 reconcile 가능 시각이 기록된다', async (): Promise<void> => {
      const { deliveryRepository, owner }: Scenario =
        await DeliveryRepositoryContract.scenario(createRepositories);
      const earlier: Delivery = DeliveryRepositoryContract.start(
        DeliveryRepositoryContract.pending(owner, 'u_000002'),
        '2026-10-08T09:00:30.000Z',
      );
      await deliveryRepository.saveAll([
        DeliveryRepositoryContract.start(DeliveryRepositoryContract.pending(owner, 'u_000001')),
        earlier,
      ]);
      const recoveredAt: Date = new Date('2026-10-08T09:05:00.000Z');

      expect(
        await deliveryRepository.findNextExpiredLease(new Date('2026-10-08T09:01:29.999Z')),
      ).toEqual({ kind: 'none' });
      const candidate: DeliveryCandidate =
        await deliveryRepository.findNextExpiredLease(recoveredAt);
      expect(DeliveryRepositoryContract.candidateId(candidate)).toBe(earlier.snapshot().id);
      const recovered: Delivery = DeliveryRepositoryContract.transitioned(
        earlier.recoverExpiredLease(recoveredAt, DeliveryRepositoryContract.duration(35_000)),
      );

      expect(
        await deliveryRepository.saveLeased(recovered, DeliveryRepositoryContract.token(TOKEN)),
      ).toEqual({ kind: 'saved' });
      expect(
        (await DeliveryRepositoryContract.snapshots(deliveryRepository, owner)).map(
          ({ state }: DeliverySnapshot): DeliverySnapshot['state'] => state,
        ),
      ).toContainEqual({
        status: 'UNKNOWN',
        unknownSince: recoveredAt,
        reconcileAt: new Date('2026-10-08T09:02:05.000Z'),
        lookupFailures: 0,
      });
    });
  }

  private static async scenario(createRepositories: RepositoriesFactory): Promise<Scenario> {
    const repositories: ContractRepositories = await createRepositories();
    return {
      ...repositories,
      owner: await DeliveryRepositoryContract.storedAlarm(repositories.alarmRepository),
    };
  }

  private static async storedAlarm(alarmRepository: AlarmRepositoryPort): Promise<AlarmId> {
    const rawAlarmId: string = randomUUID();
    if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
      throw new Error(`generated ${rawAlarmId} is not a valid AlarmId`);
    }
    const creation: AlarmCreation = Alarm.create(
      rawAlarmId,
      { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
      new Date(CREATED_ISO),
    );
    if (creation.kind !== 'created') {
      throw new Error(`contract fixture alarm is invalid: ${creation.error.code}`);
    }
    const dispatched: AlarmTransition = creation.alarm.startDispatch(new Date(CREATED_ISO));
    if (dispatched.kind !== 'transitioned') {
      throw new Error(`contract fixture alarm cannot be dispatched: ${dispatched.error.code}`);
    }
    await alarmRepository.save(dispatched.alarm);
    return rawAlarmId;
  }

  private static pending(
    owner: AlarmId,
    recipient: string,
    priority: DeliveryPriority = 'BULK',
    createdIso: string = CREATED_ISO,
  ): Delivery {
    const rawDeliveryId: string = randomUUID();
    if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
      throw new Error(`generated ${rawDeliveryId} is not a valid DeliveryId`);
    }
    if (!AlarmPredicates.isRecipientId(recipient)) {
      throw new Error(`contract fixture ${recipient} is not a valid RecipientId`);
    }
    const deliveryId: DeliveryId = rawDeliveryId;
    const recipientId: RecipientId = recipient;
    return Delivery.create(
      { id: deliveryId, alarmId: owner, recipientId, priority },
      new Date(createdIso),
    );
  }

  private static claim(delivery: Delivery, claimedIso: string = CLAIMED_ISO): Delivery {
    return DeliveryRepositoryContract.transitioned(
      delivery.claim(
        DeliveryRepositoryContract.token(TOKEN),
        new Date(claimedIso),
        DeliveryRepositoryContract.duration(60_000),
      ),
    );
  }

  private static start(delivery: Delivery, claimedIso: string = CLAIMED_ISO): Delivery {
    return DeliveryRepositoryContract.transitioned(
      DeliveryRepositoryContract.claim(delivery, claimedIso).startRequest(
        DeliveryRepositoryContract.token(TOKEN),
        new Date(claimedIso),
        DeliveryRepositoryContract.duration(10_000),
      ),
    );
  }

  private static timedOut(delivery: Delivery, claimedIso: string = CLAIMED_ISO): Delivery {
    return DeliveryRepositoryContract.transitioned(
      DeliveryRepositoryContract.start(delivery, claimedIso).recordUnknown(
        DeliveryRepositoryContract.token(TOKEN),
        new Date(SETTLED_ISO),
        DeliveryRepositoryContract.duration(35_000),
      ),
    );
  }

  private static retryWaiting(delivery: Delivery): Delivery {
    return DeliveryRepositoryContract.transitioned(
      DeliveryRepositoryContract.start(delivery).recordRateLimited(
        DeliveryRepositoryContract.token(TOKEN),
        new Date(SETTLED_ISO),
        DeliveryRepositoryContract.retryAfter(2_000),
      ),
    );
  }

  private static unreachableWaiting(delivery: Delivery): Delivery {
    return DeliveryRepositoryContract.transitioned(
      DeliveryRepositoryContract.start(delivery).recordUnreachable(
        DeliveryRepositoryContract.token(TOKEN),
        new Date(SETTLED_ISO),
        DeliveryRepositoryContract.retryAfter(5_000),
      ),
    );
  }

  private static sent(delivery: Delivery): Delivery {
    return DeliveryRepositoryContract.transitioned(
      DeliveryRepositoryContract.timedOut(delivery).reconcileFound([
        { messageId: DeliveryRepositoryContract.messageId('m_2'), sentAt: new Date(NOW_ISO) },
        { messageId: DeliveryRepositoryContract.messageId('m_1'), sentAt: new Date(SETTLED_ISO) },
      ]),
    );
  }

  private static failed(delivery: Delivery): Delivery {
    return DeliveryRepositoryContract.transitioned(
      DeliveryRepositoryContract.start(delivery).recordPermanentFailure(
        DeliveryRepositoryContract.token(TOKEN),
        'RECIPIENT_BLOCKED',
      ),
    );
  }

  private static unconfirmed(delivery: Delivery): Delivery {
    return DeliveryRepositoryContract.transitioned(
      DeliveryRepositoryContract.timedOut(delivery).expireUnconfirmed(
        new Date('2026-10-08T10:00:00.000Z'),
        DeliveryRepositoryContract.duration(600_000),
      ),
    );
  }

  private static cancelled(delivery: Delivery): Delivery {
    return DeliveryRepositoryContract.transitioned(delivery.cancel(new Date(SETTLED_ISO)));
  }

  private static transitioned(transition: DeliveryTransition): Delivery {
    if (transition.kind !== 'transitioned') {
      throw new Error(`contract fixture delivery transition failed: ${transition.kind}`);
    }
    return transition.delivery;
  }

  private static async snapshots(
    deliveryRepository: DeliveryInspection,
    owner: AlarmId,
  ): Promise<ReadonlyArray<DeliverySnapshot>> {
    return (await deliveryRepository.findByAlarmId(owner)).map(
      (delivery: Delivery): DeliverySnapshot => delivery.snapshot(),
    );
  }

  private static async statuses(
    deliveryRepository: DeliveryInspection,
    owner: AlarmId,
  ): Promise<ReadonlyArray<RecipientStatus>> {
    return (await DeliveryRepositoryContract.snapshots(deliveryRepository, owner))
      .map(({ recipientId, state }: DeliverySnapshot): RecipientStatus => [
        recipientId,
        state.status,
      ])
      .toSorted(([left]: RecipientStatus, [right]: RecipientStatus): number =>
        left.localeCompare(right),
      );
  }

  private static candidateId(candidate: DeliveryCandidate): string {
    return candidate.kind === 'found' ? candidate.delivery.snapshot().id : 'none';
  }

  private static token(value: string): LeaseToken {
    if (!DeliveryPredicates.isLeaseToken(value)) {
      throw new Error(`contract fixture ${value} is not a valid LeaseToken`);
    }
    return value;
  }

  private static messageId(value: string): MessageId {
    if (!DeliveryPredicates.isMessageId(value)) {
      throw new Error(`contract fixture ${value} is not a valid MessageId`);
    }
    return value;
  }

  private static retryAfter(value: number): RetryAfterMs {
    if (!DeliveryPredicates.isRetryAfterMs(value)) {
      throw new Error(`contract fixture ${value} is not a valid RetryAfterMs`);
    }
    return value;
  }

  private static duration(value: number): DurationMs {
    if (!DurationPredicates.isDurationMs(value)) {
      throw new Error(`contract fixture ${value} is not a valid DurationMs`);
    }
    return value;
  }

  private static retryPolicy(): RetryPolicy {
    const maxAttempts: number = 3;
    if (!DeliveryPredicates.isAttemptLimit(maxAttempts)) {
      throw new Error('contract fixture attempt limit is invalid');
    }
    const creation: RetryPolicyCreation = RetryPolicy.create({
      maxAttempts,
      baseDelayMs: DeliveryRepositoryContract.duration(1_000),
      maxDelayMs: DeliveryRepositoryContract.duration(8_000),
    });
    if (creation.kind !== 'created') {
      throw new Error(`contract fixture retry policy is invalid: ${creation.error.code}`);
    }
    return creation.policy;
  }

  private static zeroJitter(): JitterRatio {
    const ratio: number = 0;
    if (!DeliveryPredicates.isJitterRatio(ratio)) {
      throw new Error('contract fixture jitter is invalid');
    }
    return ratio;
  }
}
