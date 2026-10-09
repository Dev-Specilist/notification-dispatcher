import { ShutdownSignalPort } from '@/modules/notification/application/port/driven/for-checking-shutdown/shutdown-signal.port';

export class WorkerShutdownSignalAdapter implements ShutdownSignalPort {
  private requested: boolean = false;
  private readonly outgoingRequestAbort: AbortController = new AbortController();
  readonly outgoingRequestAbortSignal: AbortSignal = this.outgoingRequestAbort.signal;

  request(): void {
    this.requested = true;
  }

  isRequested(): boolean {
    return this.requested;
  }

  abortOutgoingRequests(): void {
    this.outgoingRequestAbort.abort();
  }
}
