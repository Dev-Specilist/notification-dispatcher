import { describe, expect, it } from 'vitest';
import { DeliveryStatusPredicates } from '@/modules/notification/domain/delivery/delivery-status.predicate';
import { DeliveryStatus } from '@/modules/notification/domain/delivery/delivery.type';

type StatusGroupCase = Readonly<
  [status: DeliveryStatus, settled: boolean, waiting: boolean, outcomePending: boolean]
>;

const STATUS_NAMES: Readonly<Record<DeliveryStatus, DeliveryStatus>> = {
  PENDING: 'PENDING',
  IN_FLIGHT: 'IN_FLIGHT',
  RETRY_WAIT: 'RETRY_WAIT',
  UNKNOWN: 'UNKNOWN',
  SENT: 'SENT',
  FAILED: 'FAILED',
  UNCONFIRMED: 'UNCONFIRMED',
  CANCELLED: 'CANCELLED',
};

describe('DeliveryStatusPredicates', () => {
  it.each<StatusGroupCase>([
    ['PENDING', false, true, false],
    ['RETRY_WAIT', false, true, false],
    ['IN_FLIGHT', false, false, true],
    ['UNKNOWN', false, false, true],
    ['SENT', true, false, false],
    ['FAILED', true, false, false],
    ['UNCONFIRMED', true, false, false],
    ['CANCELLED', true, false, false],
  ])(
    'DLV-17 DLV-20 %s는 종결(%s) · 대기(%s) · 결과 대기(%s) 중 하나로 분류된다',
    (status: DeliveryStatus, settled: boolean, waiting: boolean, outcomePending: boolean) => {
      expect([
        DeliveryStatusPredicates.isSettled(status),
        DeliveryStatusPredicates.isWaiting(status),
        DeliveryStatusPredicates.OUTCOME_PENDING.includes(status),
      ]).toEqual([settled, waiting, outcomePending]);
    },
  );

  it('모든 발송 상태는 종결 · 대기 · 결과 대기 중 정확히 한 묶음에 속한다', () => {
    const grouped: ReadonlyArray<DeliveryStatus> = [
      ...DeliveryStatusPredicates.SETTLED,
      ...DeliveryStatusPredicates.WAITING,
      ...DeliveryStatusPredicates.OUTCOME_PENDING,
    ];

    expect(grouped.toSorted()).toEqual(Object.values(STATUS_NAMES).toSorted());
  });
});
