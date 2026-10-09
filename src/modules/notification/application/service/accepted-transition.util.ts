import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryTransition } from '@/modules/notification/domain/delivery/delivery.type';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import { ExpansionJobTransition } from '@/modules/notification/domain/expansion/expansion-job.type';

export class AcceptedTransition {
  static delivery(transition: DeliveryTransition): Delivery {
    if (transition.kind === 'rejected') {
      throw new Error(`delivery transition was rejected: ${transition.reason}`);
    }
    return transition.delivery;
  }

  static expansionJob(transition: ExpansionJobTransition): ExpansionJob {
    if (transition.kind === 'rejected') {
      throw new Error(`expansion job transition was rejected: ${transition.reason}`);
    }
    return transition.job;
  }
}
