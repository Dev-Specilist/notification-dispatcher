import { z } from 'zod';

export const alarmIdParamSchema = z.object({
  id: z.uuid(),
});
