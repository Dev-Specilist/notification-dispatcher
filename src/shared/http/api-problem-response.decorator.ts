import { applyDecorators } from '@nestjs/common';
import { ApiResponse, SchemaObject } from '@nestjs/swagger';
import { FieldViolation, ProblemDetails } from '@/shared/http/problem-details.type';

export class ApiProblemResponse {
  static readonly MEDIA_TYPE: string = 'application/problem+json';

  private static readonly FIELD_VIOLATION_PROPERTIES: Record<keyof FieldViolation, SchemaObject> = {
    field: { type: 'string' },
    message: { type: 'string' },
  };

  private static readonly PROBLEM_PROPERTIES: Record<keyof ProblemDetails, SchemaObject> = {
    type: { type: 'string', example: 'about:blank' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    code: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        required: Object.keys(ApiProblemResponse.FIELD_VIOLATION_PROPERTIES),
        properties: ApiProblemResponse.FIELD_VIOLATION_PROPERTIES,
      },
    },
  };

  private static readonly SCHEMA: SchemaObject = {
    type: 'object',
    required: Object.keys(ApiProblemResponse.PROBLEM_PROPERTIES),
    properties: ApiProblemResponse.PROBLEM_PROPERTIES,
  };

  static of(status: number, description: string): MethodDecorator & ClassDecorator {
    return applyDecorators(
      ApiResponse({
        status,
        description,
        content: { [ApiProblemResponse.MEDIA_TYPE]: { schema: ApiProblemResponse.SCHEMA } },
      }),
    );
  }
}
