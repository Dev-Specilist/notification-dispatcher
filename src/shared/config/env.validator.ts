import { z } from 'zod';
import { RawEnv } from '@/shared/config/env.type';

type Validate<TSchema extends z.ZodType> = (raw: RawEnv) => Readonly<z.output<TSchema>>;

export class EnvValidator {
  static for<TSchema extends z.ZodType>(schema: TSchema): Validate<TSchema> {
    return (raw: RawEnv): Readonly<z.output<TSchema>> => {
      const result: z.ZodSafeParseResult<z.output<TSchema>> = schema.safeParse(raw);
      if (!result.success) {
        throw new Error(`Invalid environment variables\n${z.prettifyError(result.error)}`);
      }
      return result.data;
    };
  }
}
