import { describe, expect, it } from 'vitest';
import { LogLevel } from '@nestjs/common';
import { AppLogger } from '@/shared/logging/app.logger';

type LevelCase = Readonly<[LogLevel, ReadonlyArray<LogLevel>, ReadonlyArray<LogLevel>]>;

const CASES: ReadonlyArray<LevelCase> = [
  ['fatal', ['fatal'], ['error', 'verbose']],
  ['log', ['fatal', 'error', 'warn', 'log'], ['debug', 'verbose']],
  ['verbose', ['fatal', 'log', 'debug', 'verbose'], []],
];

describe('AppLogger.create', () => {
  it.each(CASES)(
    'LOG_LEVEL=%s이면 그 레벨과 더 심각한 레벨만 출력한다',
    (level: LogLevel, enabled: ReadonlyArray<LogLevel>, disabled: ReadonlyArray<LogLevel>) => {
      const logger: AppLogger = AppLogger.create({ level, format: 'pretty', role: 'api' });

      enabled.forEach((on: LogLevel): void => expect(logger.isLevelEnabled(on)).toBe(true));
      disabled.forEach((off: LogLevel): void => expect(logger.isLevelEnabled(off)).toBe(false));
    },
  );
});
