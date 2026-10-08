import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import {
  DeliveryStatus,
  DeliveryStatusCounts,
  DeliveryStatusTally,
} from '@/modules/notification/domain/delivery/delivery.type';

export class DeliveryStatusCountsFactory {
  static fromTallies(tallies: ReadonlyArray<DeliveryStatusTally>): DeliveryStatusCounts {
    return {
      PENDING: DeliveryStatusCountsFactory.countOf(tallies, 'PENDING'),
      IN_FLIGHT: DeliveryStatusCountsFactory.countOf(tallies, 'IN_FLIGHT'),
      RETRY_WAIT: DeliveryStatusCountsFactory.countOf(tallies, 'RETRY_WAIT'),
      UNKNOWN: DeliveryStatusCountsFactory.countOf(tallies, 'UNKNOWN'),
      SENT: DeliveryStatusCountsFactory.countOf(tallies, 'SENT'),
      FAILED: DeliveryStatusCountsFactory.countOf(tallies, 'FAILED'),
      UNCONFIRMED: DeliveryStatusCountsFactory.countOf(tallies, 'UNCONFIRMED'),
      CANCELLED: DeliveryStatusCountsFactory.countOf(tallies, 'CANCELLED'),
    };
  }

  private static countOf(
    tallies: ReadonlyArray<DeliveryStatusTally>,
    status: DeliveryStatus,
  ): DeliveryCount {
    const total: number = tallies
      .filter((tally: DeliveryStatusTally): boolean => tally.status === status)
      .reduce((sum: number, { count }: DeliveryStatusTally): number => sum + count, 0);
    if (!AlarmPredicates.isDeliveryCount(total)) {
      throw new Error(`${status} delivery count ${total} is not a valid DeliveryCount`);
    }
    return total;
  }
}
