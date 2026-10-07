import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { ProcessRole } from '@/shared/config/primitive.schema';
import { LogFormat, logLevelSchema } from '@/shared/logging/logging.schema';

export interface AppLoggerSettings {
  readonly level: LogLevel;
  readonly format: LogFormat;
  readonly role: ProcessRole;
}

export class AppLogger extends ConsoleLogger {
  static create({ level, format, role }: Readonly<AppLoggerSettings>): AppLogger {
    const bySeverity: ReadonlyArray<LogLevel> = logLevelSchema.options;
    return new AppLogger({
      prefix: role,
      logLevels: bySeverity.slice(0, bySeverity.indexOf(level) + 1),
      json: format === 'json',
      colors: format === 'pretty',
    });
  }
}
