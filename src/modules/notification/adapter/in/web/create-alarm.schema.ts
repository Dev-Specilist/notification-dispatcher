import { z } from 'zod';

const NUL: string = '\u0000';

const storableText = z.string().refine((value: string): boolean => !value.includes(NUL), {
  message: 'NUL 문자(U+0000)는 저장할 수 없습니다',
});

export const createAlarmSchema = z.object({
  title: storableText,
  body: storableText,
  kind: z.enum(['BULK', 'URGENT']),
  recipientIds: z.array(storableText).default([]),
});
