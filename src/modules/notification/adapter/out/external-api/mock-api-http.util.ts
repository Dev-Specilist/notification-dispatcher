import { z } from 'zod';
import { connectionNotEstablishedSchema } from '@/modules/notification/adapter/out/external-api/mock-api.schema';
import { TransportFailures } from '@/modules/notification/adapter/out/external-api/mock-api.type';

export class MockApiHttp {
  static async attempt<TResult>(
    request: () => Promise<TResult>,
    failures: Readonly<TransportFailures<TResult>>,
  ): Promise<TResult> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof TypeError && connectionNotEstablishedSchema.safeParse(error).success) {
        return failures.notConnected;
      }
      if (error instanceof TypeError || error instanceof DOMException) {
        return failures.interrupted;
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
