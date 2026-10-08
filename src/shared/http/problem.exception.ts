import { HttpException, HttpStatus } from '@nestjs/common';

export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    detail: string,
  ) {
    super(detail, status);
  }
}
