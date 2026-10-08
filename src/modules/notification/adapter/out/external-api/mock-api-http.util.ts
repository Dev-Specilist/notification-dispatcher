import { z } from 'zod';

export class MockApiHttp {
  static async attempt<TResult>(
    request: () => Promise<TResult>,
    onTransportFailure: TResult,
  ): Promise<TResult> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException) {
        return onTransportFailure;
      }
      throw error;
    }
  }

  static async parse<TSchema extends z.ZodType>(
    response: Response,
    schema: TSchema,
  ): Promise<z.ZodSafeParseResult<z.output<TSchema>>> {
    return schema.safeParse(await response.json().catch((): string => ''));
  }

  static async discardBody({ body }: Response): Promise<void> {
    if (body instanceof ReadableStream) {
      await body.cancel();
    }
  }
}
