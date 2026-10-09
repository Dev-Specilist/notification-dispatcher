import { z } from 'zod';
import { ListPosition } from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import { CursorDecoding } from '@/modules/notification/adapter/in/web/alarm-cursor.type';

export class AlarmCursor {
  private static readonly SEPARATOR: string = '|';

  private static readonly CREATED_AT_FORMAT: z.ZodISODateTime = z.iso.datetime();

  private static readonly ALARM_ID_FORMAT: z.ZodUUID = z.uuid();

  static encode({ createdAt, alarmId }: Readonly<ListPosition>): string {
    return Buffer.from(
      `${createdAt.toISOString()}${AlarmCursor.SEPARATOR}${alarmId}`,
      'utf8',
    ).toString('base64url');
  }

  static decode(encoded: string): CursorDecoding {
    const decodedBytes: Buffer = Buffer.from(encoded, 'base64url');
    if (decodedBytes.toString('base64url') !== encoded) {
      return { kind: 'invalid' };
    }
    const cursorParts: ReadonlyArray<string> = decodedBytes
      .toString('utf8')
      .split(AlarmCursor.SEPARATOR);
    if (cursorParts.length !== 2) {
      return { kind: 'invalid' };
    }
    const [createdAtIso, alarmId]: ReadonlyArray<string> = cursorParts;
    if (
      !AlarmCursor.CREATED_AT_FORMAT.safeParse(createdAtIso).success ||
      !AlarmCursor.ALARM_ID_FORMAT.safeParse(alarmId).success
    ) {
      return { kind: 'invalid' };
    }
    return { kind: 'decoded', position: { createdAt: new Date(createdAtIso), alarmId } };
  }
}
