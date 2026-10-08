import { ReconcileAttempt } from '@/modules/notification/application/port/in/reconcile-next-delivery.type';

export abstract class ReconcileNextDeliveryUseCase {
  abstract execute(): Promise<ReconcileAttempt>;
}
