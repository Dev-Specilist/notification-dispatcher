import { describe, expect, it } from 'vitest';
import { CursorDecoding } from '@/modules/notification/adapter/driving/web/alarm-cursor.type';
import { AlarmCursorCodec } from '@/modules/notification/adapter/driving/web/alarm-cursor.codec';

type MalformedCursorCase = Readonly<[label: string, cursor: string]>;

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const ISSUED_CURSOR: string = AlarmCursorCodec.encode({
  createdAt: new Date(CREATED_ISO),
  alarmId: ALARM_ID,
});

describe('AlarmCursorCodec', () => {
  it('발급한 cursor를 해석하면 같은 생성 시각과 알림 id가 나온다', (): void => {
    const cursorDecoding: CursorDecoding = AlarmCursorCodec.decode(ISSUED_CURSOR);

    expect(cursorDecoding).toEqual({
      kind: 'decoded',
      position: { createdAt: new Date(CREATED_ISO), alarmId: ALARM_ID },
    });
  });

  it.each<MalformedCursorCase>([
    ['앞에 base64url 밖의 문자가 붙은', `!!!${ISSUED_CURSOR}`],
    ['뒤에 base64url 밖의 문자가 붙은', `${ISSUED_CURSOR}!`],
    ['중간에 공백이 들어간', `${ISSUED_CURSOR.slice(0, 8)} ${ISSUED_CURSOR.slice(8)}`],
    ['padding이 붙은', `${ISSUED_CURSOR}=`],
    ['표준 base64 문자 +가 섞인', `${ISSUED_CURSOR.slice(0, 8)}+${ISSUED_CURSOR.slice(8)}`],
    ['마지막 문자의 남는 비트만 다른', `${ISSUED_CURSOR.slice(0, -1)}B`],
  ])(
    '%s cursor는 원래 cursor와 같게 해석하지 않고 거절한다',
    (_label: string, cursor: string): void => {
      expect(AlarmCursorCodec.decode(cursor)).toEqual({ kind: 'invalid' });
    },
  );
});
