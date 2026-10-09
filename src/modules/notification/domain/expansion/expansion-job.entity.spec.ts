import { describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import {
  ExpansionCursor,
  ExpansionJobSnapshot,
  ExpansionJobTransition,
} from '@/modules/notification/domain/expansion/expansion-job.type';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';

type CursorMatchCase = Readonly<
  [label: string, storedCursor: ExpansionCursor, fetchedWith: ExpansionCursor, expected: boolean]
>;

type FinishedJobCase = Readonly<
  [label: string, finish: (job: ExpansionJob) => ExpansionJobTransition]
>;

const ENQUEUED_ISO: string = '2026-10-08T09:00:00.000Z';
const EXPANDED_ISO: string = '2026-10-08T09:01:00.000Z';
const FIRST: ExpansionCursor = { kind: 'first' };
const NEXT_MW: ExpansionCursor = { kind: 'next', token: 'Mw' };
const NEXT_NG: ExpansionCursor = { kind: 'next', token: 'Ng' };

const alarmId = (): AlarmId => {
  const rawAlarmId: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error(`test fixture ${rawAlarmId} is not a valid AlarmId`);
  }
  return rawAlarmId;
};

const transitioned = (transition: ExpansionJobTransition): ExpansionJob => {
  KindAssertion.assertKind(transition, 'transitioned');
  const { job }: KindMember<ExpansionJobTransition, 'transitioned'> = transition;
  return job;
};

const enqueued = (): ExpansionJob => ExpansionJob.enqueue(alarmId(), new Date(ENQUEUED_ISO));

const inProgressAt = (cursor: ExpansionCursor): ExpansionJob =>
  ExpansionJob.reconstitute({
    alarmId: alarmId(),
    enqueuedAt: new Date(ENQUEUED_ISO),
    progress: { kind: 'in-progress', cursor },
  });

describe('ExpansionJob', () => {
  it('UC-04 확장 작업을 만들면 첫 페이지부터 읽는 진행 중 상태다', () => {
    const job: ExpansionJob = enqueued();

    expect(job.nextPage()).toEqual({ kind: 'fetch', cursor: FIRST });
    expect(job.snapshot()).toEqual({
      alarmId: alarmId(),
      enqueuedAt: new Date(ENQUEUED_ISO),
      progress: { kind: 'in-progress', cursor: FIRST },
    });
  });

  it('UC-06 다음 cursor가 있는 페이지를 기록하면 그 cursor부터 이어 읽는다', () => {
    const advanced: ExpansionJob = transitioned(
      enqueued().advance({ kind: 'next', token: 'Mw' }, new Date(EXPANDED_ISO)),
    );

    expect(advanced.nextPage()).toEqual({ kind: 'fetch', cursor: NEXT_MW });
    expect(advanced.isCompleted()).toBe(false);
  });

  it('UC-06 마지막 페이지를 기록하면 확장이 완료되어 더 읽을 페이지가 없다', () => {
    const completed: ExpansionJob = transitioned(
      inProgressAt(NEXT_MW).advance({ kind: 'end' }, new Date(EXPANDED_ISO)),
    );

    expect(completed.isCompleted()).toBe(true);
    expect(completed.nextPage()).toEqual({ kind: 'completed' });
    expect(completed.snapshot().progress).toEqual({
      kind: 'completed',
      completedAt: new Date(EXPANDED_ISO),
    });
  });

  it('UC-08 진행 중인 확장을 멈추면 중단 상태가 되어 더 읽을 페이지가 없다', () => {
    const stopped: ExpansionJob = transitioned(inProgressAt(NEXT_MW).stop(new Date(EXPANDED_ISO)));

    expect(stopped.isCompleted()).toBe(false);
    expect(stopped.nextPage()).toEqual({ kind: 'stopped' });
    expect(stopped.snapshot().progress).toEqual({
      kind: 'stopped',
      stoppedAt: new Date(EXPANDED_ISO),
    });
  });

  it.each<CursorMatchCase>([
    ['첫 페이지끼리', FIRST, FIRST, true],
    ['같은 토큰의 다음 페이지끼리', NEXT_MW, NEXT_MW, true],
    ['다른 토큰의 다음 페이지', NEXT_MW, NEXT_NG, false],
    ['저장된 첫 페이지와 다음 페이지', FIRST, NEXT_MW, false],
    ['저장된 다음 페이지와 첫 페이지', NEXT_MW, FIRST, false],
  ])(
    'UC-07 %s는 저장된 cursor와 같은 위치인지 판정한다',
    (
      _label: string,
      storedCursor: ExpansionCursor,
      fetchedWith: ExpansionCursor,
      expected: boolean,
    ): void => {
      expect(inProgressAt(storedCursor).isAt(fetchedWith)).toBe(expected);
    },
  );

  it.each<FinishedJobCase>([
    [
      '완료',
      (job: ExpansionJob): ExpansionJobTransition =>
        job.advance({ kind: 'end' }, new Date(EXPANDED_ISO)),
    ],
    ['중단', (job: ExpansionJob): ExpansionJobTransition => job.stop(new Date(EXPANDED_ISO))],
  ])(
    'UC-07 %s된 확장 작업은 어떤 cursor에도 있지 않고 다시 진행하거나 멈출 수 없다',
    (_label: string, finish: (job: ExpansionJob) => ExpansionJobTransition): void => {
      const finished: ExpansionJob = transitioned(finish(inProgressAt(NEXT_MW)));
      const rejected: ExpansionJobTransition = { kind: 'rejected', reason: 'NOT_IN_PROGRESS' };

      expect(finished.isAt(NEXT_MW)).toBe(false);
      expect(finished.advance(NEXT_MW, new Date(EXPANDED_ISO))).toEqual(rejected);
      expect(finished.advance({ kind: 'end' }, new Date(EXPANDED_ISO))).toEqual(rejected);
      expect(finished.stop(new Date(EXPANDED_ISO))).toEqual(rejected);
    },
  );

  it('전이해도 원래 확장 작업 객체는 바뀌지 않는다', () => {
    const job: ExpansionJob = enqueued();

    transitioned(job.advance({ kind: 'end' }, new Date(EXPANDED_ISO)));

    expect(job.nextPage()).toEqual({ kind: 'fetch', cursor: FIRST });
  });

  it('만들거나 복원할 때 넘긴 Date를 나중에 바꿔도 확장 작업 내부 상태는 바뀌지 않는다', () => {
    const enqueuedAt: Date = new Date(ENQUEUED_ISO);
    const stoppedAt: Date = new Date(EXPANDED_ISO);
    const job: ExpansionJob = ExpansionJob.enqueue(alarmId(), enqueuedAt);
    const restored: ExpansionJob = ExpansionJob.reconstitute({
      alarmId: alarmId(),
      enqueuedAt,
      progress: { kind: 'stopped', stoppedAt },
    });

    enqueuedAt.setUTCFullYear(1990);
    stoppedAt.setUTCFullYear(1990);

    expect(job.snapshot().enqueuedAt).toEqual(new Date(ENQUEUED_ISO));
    expect(restored.snapshot()).toMatchObject({
      enqueuedAt: new Date(ENQUEUED_ISO),
      progress: { stoppedAt: new Date(EXPANDED_ISO) },
    });
  });

  it('snapshot으로 받은 Date를 바꿔도 확장 작업 내부 상태는 바뀌지 않는다', () => {
    const job: ExpansionJob = transitioned(
      enqueued().advance({ kind: 'end' }, new Date(EXPANDED_ISO)),
    );
    const snapshot: ExpansionJobSnapshot = job.snapshot();

    snapshot.enqueuedAt.setUTCFullYear(1990);
    if (snapshot.progress.kind === 'completed') {
      snapshot.progress.completedAt.setUTCFullYear(1990);
    }

    expect(job.snapshot()).toMatchObject({
      enqueuedAt: new Date(ENQUEUED_ISO),
      progress: { completedAt: new Date(EXPANDED_ISO) },
    });
  });
});
