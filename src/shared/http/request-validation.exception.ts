import { BadRequestException, StandardSchemaValidationPipeOptions } from '@nestjs/common';
import { FieldViolation } from '@/shared/http/problem-details.type';

type ExceptionFactory = NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>;

type SchemaIssue = Parameters<ExceptionFactory>[0][number];

type IssuePathSegment = NonNullable<SchemaIssue['path']>[number];

export class RequestValidationException extends BadRequestException {
  constructor(readonly violations: ReadonlyArray<FieldViolation>) {
    super('요청 값이 올바르지 않습니다');
  }

  static readonly factory: ExceptionFactory = (
    issues: ReadonlyArray<SchemaIssue>,
  ): RequestValidationException => RequestValidationException.fromIssues(issues);

  static fromIssues(issues: ReadonlyArray<SchemaIssue>): RequestValidationException {
    return new RequestValidationException(
      issues.map(({ path, message }: SchemaIssue): FieldViolation => ({
        field: (path ?? [])
          .map((segment: IssuePathSegment): string =>
            RequestValidationException.segmentName(segment),
          )
          .join('.'),
        message,
      })),
    );
  }

  private static segmentName(segment: IssuePathSegment): string {
    return typeof segment === 'object' ? String(segment.key) : String(segment);
  }
}
