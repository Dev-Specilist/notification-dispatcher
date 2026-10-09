import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import { ExpansionJobTransition } from '@/modules/notification/domain/expansion/expansion-job.type';

export class AcceptedTransition {
  static expansionJob(transition: ExpansionJobTransition): ExpansionJob {
    if (transition.kind === 'rejected') {
      throw new Error(`expansion job transition was rejected: ${transition.reason}`);
    }
    return transition.job;
  }
}
