import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ProblemDetailsFilter } from '@/shared/http/problem-details.filter';
import { RequestValidationException } from '@/shared/http/request-validation.exception';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    {
      provide: APP_PIPE,
      useValue: new StandardSchemaValidationPipe({
        exceptionFactory: RequestValidationException.factory,
      }),
    },
  ],
})
export class ApiStandardModule {}
