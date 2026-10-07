import { ArgumentsHost, Catch, ExceptionFilter, ServiceUnavailableException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch(ServiceUnavailableException)
export class HealthCheckFilter implements ExceptionFilter<ServiceUnavailableException> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    const response: object = host.switchToHttp().getResponse();
    this.adapterHost.httpAdapter.reply(response, exception.getResponse(), exception.getStatus());
  }
}
