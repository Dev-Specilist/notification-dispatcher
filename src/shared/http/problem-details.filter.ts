import { STATUS_CODES } from 'node:http';
import { inspect } from 'node:util';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ProblemDetails } from '@/shared/http/problem-details.type';

type ThrownValue = object | string | number | boolean | bigint | symbol;

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter<ThrownValue> {
  private static readonly CONTENT_TYPE: string = 'application/problem+json; charset=utf-8';
  private static readonly SERVER_ERROR_FLOOR: number = 500;

  private readonly logger: Logger = new Logger('ProblemDetails');

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: ThrownValue, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const context = host.switchToHttp();
    const instance: string = httpAdapter.getRequestUrl(context.getRequest());
    const problem: ProblemDetails = ProblemDetailsFilter.toProblem(exception, instance);

    if (problem.status >= ProblemDetailsFilter.SERVER_ERROR_FLOOR) {
      this.logger.error(
        `${instance} failed`,
        exception instanceof Error ? exception.stack : inspect(exception),
      );
    }

    const response: object = context.getResponse();
    httpAdapter.setHeader(response, 'Content-Type', ProblemDetailsFilter.CONTENT_TYPE);
    httpAdapter.reply(response, problem, problem.status);
  }

  private static toProblem(exception: ThrownValue, instance: string): ProblemDetails {
    if (exception instanceof HttpException) {
      const status: number = exception.getStatus();
      return ProblemDetailsFilter.problem(status, instance, {
        detail: exception.message,
        code: ProblemDetailsFilter.codeOf(status),
        errors: [],
      });
    }
    return ProblemDetailsFilter.problem(HttpStatus.INTERNAL_SERVER_ERROR, instance, {
      detail: '서버 내부 오류가 발생했습니다',
      code: 'INTERNAL_SERVER_ERROR',
      errors: [],
    });
  }

  private static problem(
    status: number,
    instance: string,
    { detail, code, errors }: Pick<ProblemDetails, 'detail' | 'code' | 'errors'>,
  ): ProblemDetails {
    return {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Unknown Status',
      status,
      detail,
      instance,
      code,
      errors,
    };
  }

  private static codeOf(status: number): string {
    const name: string = HttpStatus[status];
    return name ?? `HTTP_${status}`;
  }
}
