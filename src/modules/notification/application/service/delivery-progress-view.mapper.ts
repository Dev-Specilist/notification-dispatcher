import { DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryStatusCounts } from '@/modules/notification/domain/delivery/delivery.type';
import { DeliveryProgressView } from '@/modules/notification/application/port/in/delivery-progress-view.type';

export class DeliveryProgressViewMapper {
  static toView(deliveryStatusCounts: DeliveryStatusCounts): DeliveryProgressView {
    return {
      total: Object.values(deliveryStatusCounts).reduce(
        (sum: number, statusCount: DeliveryCount): number => sum + statusCount,
        0,
      ),
      byStatus: { ...deliveryStatusCounts },
    };
  }
}
