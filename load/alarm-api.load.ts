import { check, fail, sleep } from 'k6';
import type { JSONValue } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import type { Params, Response } from 'k6/http';
import { Gauge, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';

type AlarmEndpoint =
  | 'create-alarm'
  | 'start-dispatch'
  | 'get-alarm'
  | 'list-alarms'
  | 'cancel-alarm'
  | 'urgent-progress';

type NotYetRequestedStatus = 'PENDING' | 'IN_FLIGHT';

interface DispatchSnapshot {
  readonly alarmStatus: string;
  readonly sentCount: number;
  readonly observedAtMs: number;
}

interface LoadTestData {
  readonly alarmId: string;
  readonly dispatchStartSnapshot: DispatchSnapshot;
}

class LoadEnv {
  static text(name: string, fallback: string): string {
    return name in __ENV ? __ENV[name] : fallback;
  }

  static positiveInteger(name: string, fallback: number): number {
    const parsedValue: number = Number(LoadEnv.text(name, String(fallback)));
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new Error(`${name}는 양의 정수여야 합니다`);
    }
    return parsedValue;
  }
}

const apiUrl: string = LoadEnv.text('API_URL', 'http://localhost:3000');
const requestsPerSecond: number = LoadEnv.positiveInteger('RATE', 50);
const testDuration: string = LoadEnv.text('DURATION', '60s');

const URGENT_RECIPIENT_COUNT: number = 100;
const URGENT_START_AFTER: string = LoadEnv.text('URGENT_START_AFTER', '20s');
const URGENT_POLL_INTERVAL_SECONDS: number = 0.2;
const URGENT_REQUEST_LIMIT_MS: number = 30_000;
const NOT_YET_REQUESTED_STATUSES: ReadonlyArray<NotYetRequestedStatus> = ['PENDING', 'IN_FLIGHT'];

const urgentAllRequestedTrend: Trend = new Trend('urgent_all_requested_ms', true);
const sentDeliveriesGauge: Gauge = new Gauge('dispatch_sent_deliveries');
const sentPerSecondGauge: Gauge = new Gauge('dispatch_sent_per_second');

export const options: Options = {
  discardResponseBodies: true,
  scenarios: {
    alarm_reads: {
      executor: 'constant-arrival-rate',
      rate: requestsPerSecond,
      timeUnit: '1s',
      duration: testDuration,
      preAllocatedVUs: requestsPerSecond,
      maxVUs: requestsPerSecond * 2,
    },
    urgent_latency: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      startTime: URGENT_START_AFTER,
      maxDuration: '60s',
      exec: 'urgentLatency',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
    'http_req_duration{endpoint:get-alarm}': ['p(95)<200'],
    'http_req_duration{endpoint:list-alarms}': ['p(95)<200'],
    checks: ['rate>0.99'],
    dispatch_sent_per_second: ['value>0'],
    urgent_all_requested_ms: [`max<${URGENT_REQUEST_LIMIT_MS}`],
  },
};

class AlarmApi {
  static params(endpoint: AlarmEndpoint): Params {
    return {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'text',
      tags: { endpoint },
    };
  }

  static expectStatus(response: Response, expectedStatus: number, requestLabel: string): void {
    if (response.status !== expectedStatus) {
      fail(`${requestLabel} 응답이 ${expectedStatus}가 아니라 ${response.status}입니다`);
    }
  }

  static stringAt(response: Response, path: string): string {
    const selectedValue: JSONValue = response.json(path);
    if (typeof selectedValue !== 'string') {
      return fail(`응답의 ${path}가 문자열이 아닙니다`);
    }
    return selectedValue;
  }

  static numberAt(response: Response, path: string): number {
    const selectedValue: JSONValue = response.json(path);
    if (typeof selectedValue !== 'number') {
      return fail(`응답의 ${path}가 숫자가 아닙니다`);
    }
    return selectedValue;
  }

  static createUrgentAlarm(recipientIds: ReadonlyArray<string>): string {
    const createResponse: Response = http.post(
      `${apiUrl}/alarms`,
      JSON.stringify({
        title: 'k6 긴급 알림',
        body: '대량 발송 중 긴급 알림 지연 측정',
        kind: 'URGENT',
        recipientIds,
      }),
      AlarmApi.params('create-alarm'),
    );
    AlarmApi.expectStatus(createResponse, 201, 'POST /alarms (URGENT)');
    return AlarmApi.stringAt(createResponse, 'id');
  }

  static notYetRequestedCount(alarmId: string): number {
    const alarmResponse: Response = http.get(
      `${apiUrl}/alarms/${alarmId}`,
      AlarmApi.params('urgent-progress'),
    );
    AlarmApi.expectStatus(alarmResponse, 200, 'GET /alarms/:id (URGENT)');
    return NOT_YET_REQUESTED_STATUSES.reduce(
      (waitingTotal: number, status: NotYetRequestedStatus): number =>
        waitingTotal + AlarmApi.numberAt(alarmResponse, `deliveries.byStatus.${status}`),
      0,
    );
  }

  static createBulkAlarm(): string {
    const createResponse: Response = http.post(
      `${apiUrl}/alarms`,
      JSON.stringify({
        title: 'k6 부하 테스트',
        body: '발송 중 조회 API 응답 시간 측정',
        kind: 'BULK',
      }),
      AlarmApi.params('create-alarm'),
    );
    AlarmApi.expectStatus(createResponse, 201, 'POST /alarms');
    return AlarmApi.stringAt(createResponse, 'id');
  }

  static startDispatch(alarmId: string): void {
    const dispatchResponse: Response = http.post(
      `${apiUrl}/alarms/${alarmId}/dispatch`,
      '',
      AlarmApi.params('start-dispatch'),
    );
    AlarmApi.expectStatus(dispatchResponse, 202, 'POST /alarms/:id/dispatch');
  }

  static dispatchSnapshot(alarmId: string): DispatchSnapshot {
    const alarmResponse: Response = http.get(
      `${apiUrl}/alarms/${alarmId}`,
      AlarmApi.params('get-alarm'),
    );
    AlarmApi.expectStatus(alarmResponse, 200, 'GET /alarms/:id');
    return {
      alarmStatus: AlarmApi.stringAt(alarmResponse, 'status'),
      sentCount: AlarmApi.numberAt(alarmResponse, 'deliveries.byStatus.SENT'),
      observedAtMs: Date.now(),
    };
  }

  static cancel(alarmId: string): void {
    const cancelResponse: Response = http.post(
      `${apiUrl}/alarms/${alarmId}/cancel`,
      '',
      AlarmApi.params('cancel-alarm'),
    );
    AlarmApi.expectStatus(cancelResponse, 200, 'POST /alarms/:id/cancel');
  }
}

export function setup(): LoadTestData {
  const alarmId: string = AlarmApi.createBulkAlarm();
  AlarmApi.startDispatch(alarmId);
  return { alarmId, dispatchStartSnapshot: AlarmApi.dispatchSnapshot(alarmId) };
}

export default function (data: Readonly<LoadTestData>): void {
  const { alarmId }: Readonly<LoadTestData> = data;
  if (exec.scenario.iterationInTest % 2 === 0) {
    const alarmResponse: Response = http.get(`${apiUrl}/alarms/${alarmId}`, {
      tags: { endpoint: 'get-alarm' },
    });
    check(alarmResponse.status, {
      'GET /alarms/:id 200': (status: number): boolean => status === 200,
    });
    return;
  }
  const listResponse: Response = http.get(`${apiUrl}/alarms?limit=20`, {
    tags: { endpoint: 'list-alarms' },
  });
  check(listResponse.status, {
    'GET /alarms?limit=20 200': (status: number): boolean => status === 200,
  });
}

export function urgentLatency(): void {
  const recipientIds: Array<string> = [];
  for (
    let recipientNumber: number = 1;
    recipientNumber <= URGENT_RECIPIENT_COUNT;
    recipientNumber += 1
  ) {
    recipientIds.push(`u_${String(recipientNumber).padStart(6, '0')}`);
  }
  const urgentAlarmId: string = AlarmApi.createUrgentAlarm(recipientIds);
  const dispatchStartedAtMs: number = Date.now();
  AlarmApi.startDispatch(urgentAlarmId);
  while (Date.now() - dispatchStartedAtMs < URGENT_REQUEST_LIMIT_MS) {
    if (AlarmApi.notYetRequestedCount(urgentAlarmId) === 0) {
      urgentAllRequestedTrend.add(Date.now() - dispatchStartedAtMs);
      return;
    }
    sleep(URGENT_POLL_INTERVAL_SECONDS);
  }
  urgentAllRequestedTrend.add(Date.now() - dispatchStartedAtMs);
  fail(
    `긴급 알림 ${URGENT_RECIPIENT_COUNT}건의 첫 요청이 ${URGENT_REQUEST_LIMIT_MS}ms 안에 모두 나가지 않았습니다`,
  );
}

export function teardown(data: Readonly<LoadTestData>): void {
  const { alarmId, dispatchStartSnapshot }: Readonly<LoadTestData> = data;
  const dispatchEndSnapshot: DispatchSnapshot = AlarmApi.dispatchSnapshot(alarmId);
  const sentDuringTest: number = dispatchEndSnapshot.sentCount - dispatchStartSnapshot.sentCount;
  const elapsedSeconds: number =
    (dispatchEndSnapshot.observedAtMs - dispatchStartSnapshot.observedAtMs) / 1000;
  sentDeliveriesGauge.add(sentDuringTest);
  sentPerSecondGauge.add(sentDuringTest / elapsedSeconds);
  if (dispatchEndSnapshot.alarmStatus === 'DISPATCHING') {
    AlarmApi.cancel(alarmId);
  }
}
