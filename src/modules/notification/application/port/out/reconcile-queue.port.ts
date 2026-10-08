import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliveryCandidate,
  ReconciledSave,
} from '@/modules/notification/application/port/out/delivery-repository.type';

export abstract class ReconcileQueuePort {
  abstract findNextReconcilable(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract saveReconciled(delivery: Delivery, previous: Delivery): Promise<ReconciledSave>;
}
