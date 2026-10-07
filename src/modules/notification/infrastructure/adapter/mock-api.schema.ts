import { z } from 'zod';

export const acceptedBodySchema = z.object({ messageId: z.string() });

export const rejectedBodySchema = z.object({
  code: z.enum(['RECIPIENT_BLOCKED', 'UNKNOWN_RECIPIENT', 'INVALID_REQUEST']),
});
