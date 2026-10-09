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
import type { Request } from 'express';
import { ProblemDetails } from '@/shared/http/problem-details.type';
import { ProblemException } from '@/shared/http/problem.exception';
import { RequestValidationException } from '@/shared/http/request-validation.exception';

type ThrownValue = object | string | number | boolean | bigint | symbol;

type HttpContext = ReturnType<ArgumentsHost['switchToHttp']>;

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter<ThrownValue> {
  private static readonly CONTENT_TYPE: string = 'application/problem+json; charset=utf-8';
  private static readonly SERVER_ERROR_FLOOR: number = 500;
  private static readonly SERVER_ERROR_DETAIL: string = '서버 내부 오류가 발생했습니다';

  private readonly logger: Logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: ThrownValue, host: ArgumentsHost): void {
    const { httpAdapter }: HttpAdapterHost = this.adapterHost;
    const context: HttpContext = host.switchToHttp();
    const { originalUrl: instance }: Request = context.getRequest<Request>();
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
    if (exception instanceof RequestValidationException) {
      return ProblemDetailsFilter.problem(HttpStatus.BAD_REQUEST, instance, {
        detail: exception.message,
        code: 'VALIDATION_FAILED',
        errors: exception.violations,
      });
    }
    if (exception instanceof HttpException) {
      const status: number = exception.getStatus();
      return ProblemDetailsFilter.problem(status, instance, {
        detail:
          status >= ProblemDetailsFilter.SERVER_ERROR_FLOOR
            ? ProblemDetailsFilter.SERVER_ERROR_DETAIL
            : exception.message,
        code:
          exception instanceof ProblemException
            ? exception.code
            : ProblemDetailsFilter.codeOf(status),
        errors: [],
      });
    }
    return ProblemDetailsFilter.problem(HttpStatus.INTERNAL_SERVER_ERROR, instance, {
      detail: ProblemDetailsFilter.SERVER_ERROR_DETAIL,
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
      title: ProblemDetailsFilter.titleOf(status),
      status,
      detail,
      instance,
      code,
      errors,
    };
  }

  private static titleOf(status: number): string {
    const reasonPhrase: (typeof STATUS_CODES)[number] = STATUS_CODES[status];
    return typeof reasonPhrase === 'string' ? reasonPhrase : 'Unknown Status';
  }

  private static codeOf(status: number): string {
    const name: string = HttpStatus[status];
    return typeof name === 'string' ? name : `HTTP_${status}`;
  }
}
