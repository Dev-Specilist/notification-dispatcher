import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { logLevelSchema } from '@/shared/logging/logging.schema';
import { AppLoggerSettings } from '@/shared/logging/logging.type';

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
