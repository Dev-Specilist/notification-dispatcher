import { ReconcileAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.type';

export abstract class ReconcileNextDeliveryUseCase {
  abstract execute(): Promise<ReconcileAttempt>;
}
