import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export interface LogEntry {
  businessId?: string;
  category?: string;
  durationMs?: number;
  errorCode?: string;
  event?: string;
  level: LogLevel;
  message: string;
  method?: string;
  operation?: string;
  requestId?: string;
  route?: string;
  statusCode?: number;
  timestamp?: string;
  userId?: string;
  [key: string]: unknown;
}

const REDACTED = '[redacted]';
const SECRET_KEYS = [
  'authorization',
  'accessToken',
  'apiKey',
  'authToken',
  'body',
  'communicationBody',
  'conversation',
  'customerAddress',
  'customerEmail',
  'customerName',
  'customerPhone',
  'databaseUrl',
  'DATABASE_URL',
  'email',
  'headers',
  'idempotencyKey',
  'idempotencyRequest',
  'jwt',
  'JWT_SECRET',
  'OPENAI_API_KEY',
  'password',
  'passwordHash',
  'phone',
  'publicScopeHash',
  'publicToken',
  'publicTokenHash',
  'rawToken',
  'recipient',
  'refreshToken',
  'requestHash',
  'RESEND_API_KEY',
  'responseBody',
  'S3_SECRET_ACCESS_KEY',
  'secret',
  'signedUrl',
  'smsBody',
  'token',
  'TORI_MESSAGE',
  'TWILIO_AUTH_TOKEN',
];

const SECRET_KEY_PATTERN = new RegExp(
  `(^|[_-])(${SECRET_KEYS.map(escapeRegex).join('|')})([_-]|$)`,
  'i',
);

const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /Basic\s+[A-Za-z0-9._~+/=-]+/gi,
  /(postgres(?:ql)?:\/\/)[^\s"']+/gi,
  /(sk|rk|re|SG|AC|SK|xoxb|xoxp)_[A-Za-z0-9._-]{12,}/g,
  /\beyJ[A-Za-z0-9._-]{20,}\b/g,
];

@Injectable()
export class StructuredLogger {
  private readonly format: string;
  private readonly minimumLevel: LogLevel;

  constructor(config: ConfigService) {
    const nodeEnv = config.get<string>('NODE_ENV');
    this.format = config.get<string>(
      'LOG_FORMAT',
      nodeEnv === 'production' ? 'json' : 'pretty',
    );
    this.minimumLevel = normaliseLevel(
      config.get<string>('LOG_LEVEL'),
      nodeEnv === 'test' ? 'warn' : 'info',
    );
  }

  child() {
    return this;
  }

  debug(
    message: string,
    fields: Omit<Partial<LogEntry>, 'level' | 'message'> = {},
  ) {
    this.write({ ...fields, level: 'debug', message });
  }

  info(
    message: string,
    fields: Omit<Partial<LogEntry>, 'level' | 'message'> = {},
  ) {
    this.write({ ...fields, level: 'info', message });
  }

  warn(
    message: string,
    fields: Omit<Partial<LogEntry>, 'level' | 'message'> = {},
  ) {
    this.write({ ...fields, level: 'warn', message });
  }

  error(
    message: string,
    fields: Omit<Partial<LogEntry>, 'level' | 'message'> = {},
  ) {
    this.write({ ...fields, level: 'error', message });
  }

  write(entry: LogEntry) {
    if (!shouldWrite(entry.level, this.minimumLevel)) return;
    const payload = redact({
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    }) as LogEntry;

    if (this.format === 'json') {
      this.writeLine(entry.level, JSON.stringify(payload));
      return;
    }

    const suffix = Object.fromEntries(
      Object.entries(payload).filter(
        ([key]) => !['level', 'message', 'timestamp'].includes(key),
      ),
    );
    this.writeLine(
      entry.level,
      `${payload.timestamp} ${entry.level.toUpperCase()} ${payload.message} ${
        Object.keys(suffix).length ? JSON.stringify(suffix) : ''
      }`.trim(),
    );
  }

  private writeLine(level: LogLevel, line: string) {
    if (level === 'error') {
      console.error(line);
      return;
    }
    if (level === 'warn') {
      console.warn(line);
      return;
    }
    console.info(line);
  }
}

export function createRequestId() {
  return randomUUID();
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redact(item),
      ]),
    );
  }
  return value;
}

export function safeErrorCode(error: unknown) {
  if (error instanceof Error) {
    return error.name || 'ERROR';
  }
  return 'UNKNOWN_ERROR';
}

function isSensitiveKey(key: string) {
  return SECRET_KEY_PATTERN.test(key);
}

function redactString(value: string) {
  return SECRET_VALUE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    value,
  );
}

function shouldWrite(level: LogLevel, minimum: LogLevel) {
  return levelRank(level) >= levelRank(minimum);
}

function levelRank(level: LogLevel) {
  return { debug: 10, info: 20, warn: 30, error: 40 }[level];
}

function normaliseLevel(value?: string, fallback: LogLevel = 'info'): LogLevel {
  if (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
  ) {
    return value;
  }
  return fallback;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
