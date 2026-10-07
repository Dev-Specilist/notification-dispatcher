export interface FieldViolation {
  readonly field: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: string;
  readonly errors: ReadonlyArray<FieldViolation>;
}
