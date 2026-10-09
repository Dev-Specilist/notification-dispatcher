import { ShutdownSignalPort } from '@/modules/notification/application/port/driven/for-checking-shutdown/shutdown-signal.port';

export class WorkerShutdownSignalAdapter implements ShutdownSignalPort {
  private requested: boolean = false;

  request(): void {
    this.requested = true;
  }

  isRequested(): boolean {
    return this.requested;
  }
}
