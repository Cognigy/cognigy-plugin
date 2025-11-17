/**
 * Simple logger utility for the MCP server
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: any) {
    if (this.shouldLog('debug')) {
      // Use stderr to avoid polluting stdout (MCP uses stdio protocol)
      console.error(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: any) {
    if (this.shouldLog('info')) {
      // Use stderr to avoid polluting stdout (MCP uses stdio protocol)
      console.error(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: any) {
    if (this.shouldLog('warn')) {
      // Use stderr to avoid polluting stdout (MCP uses stdio protocol)
      console.error(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: any) {
    if (this.shouldLog('error')) {
      // Use stderr to avoid polluting stdout (MCP uses stdio protocol)
      console.error(this.formatMessage('error', message, meta));
    }
  }
}

export const logger = new Logger();

