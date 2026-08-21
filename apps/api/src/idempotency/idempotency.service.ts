import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type JsonLike = unknown;

export type AuthenticatedIdempotencyScope = {
  businessId: string;
  idempotencyKey?: string | null;
  operation: string;
  request: JsonLike;
  userId: string;
};

export type PublicIdempotencyScope = {
  fallbackKey?: string;
  idempotencyKey?: string | null;
  operation: string;
  publicScope: string;
  request: JsonLike;
};

type IdempotencyScope =
  | ({ type: 'authenticated' } & AuthenticatedIdempotencyScope)
  | ({ type: 'public' } & PublicIdempotencyScope);

type IdempotencyRecordSnapshot = {
  id: string;
  requestHash: string;
  responseBody: unknown;
  status: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';
  updatedAt: Date;
};

@Injectable()
export class IdempotencyService {
  private readonly enabled: boolean;
  private readonly production: boolean;
  private readonly retentionHours: number;
  private readonly staleSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('IDEMPOTENCY_ENABLED') !== 'false';
    this.production = config.get<string>('NODE_ENV') === 'production';
    this.retentionHours = positiveNumber(
      config.get<string>('IDEMPOTENCY_RETENTION_HOURS'),
      48,
    );
    this.staleSeconds = positiveNumber(
      config.get<string>('IDEMPOTENCY_IN_PROGRESS_TTL_SECONDS'),
      120,
    );
  }

  runAuthenticated<T>(
    scope: AuthenticatedIdempotencyScope,
    handler: () => Promise<T>,
  ): Promise<T> {
    return this.run({ ...scope, type: 'authenticated' }, handler);
  }

  runPublic<T>(
    scope: PublicIdempotencyScope,
    handler: () => Promise<T>,
  ): Promise<T> {
    return this.run({ ...scope, type: 'public' }, handler);
  }

  private async run<T>(
    scope: IdempotencyScope,
    handler: () => Promise<T>,
  ): Promise<T> {
    const rawKey = (
      scope.idempotencyKey ??
      (scope.type === 'public' ? scope.fallbackKey : undefined)
    )?.trim();
    if (!this.enabled) {
      return handler();
    }

    if (!rawKey) {
      if (this.production) {
        throw new BadRequestException({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key is required for this action.',
        });
      }
      return handler();
    }

    if (rawKey.length < 8 || rawKey.length > 240) {
      throw new UnprocessableEntityException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be between 8 and 240 characters.',
      });
    }

    const keyHash = hashValue(rawKey);
    const requestHash = hashValue(stableStringify(toJson(scope.request)));
    const expiresAt = new Date(
      Date.now() + this.retentionHours * 60 * 60 * 1000,
    );

    const claimed = await this.claim(scope, keyHash, requestHash, expiresAt);
    if (!claimed.ownsExecution) {
      return this.resolveExisting<T>(claimed.record, requestHash, scope);
    }

    try {
      const response = await handler();
      await this.prisma.idempotencyRecord.update({
        data: {
          completedAt: new Date(),
          responseBody: toJson(response) as never,
          responseStatus: 200,
          status: 'SUCCESS',
        },
        where: { id: claimed.record.id },
      });
      return response;
    } catch (error) {
      await this.prisma.idempotencyRecord
        .update({
          data: {
            completedAt: new Date(),
            errorCode: errorCode(error),
            status: 'FAILED',
          },
          where: { id: claimed.record.id },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async claim(
    scope: IdempotencyScope,
    keyHash: string,
    requestHash: string,
    expiresAt: Date,
  ): Promise<{
    ownsExecution: boolean;
    record: IdempotencyRecordSnapshot;
  }> {
    const data =
      scope.type === 'authenticated'
        ? {
            businessId: scope.businessId,
            expiresAt,
            keyHash,
            operation: scope.operation,
            requestHash,
            status: 'IN_PROGRESS' as const,
            userId: scope.userId,
          }
        : {
            expiresAt,
            keyHash,
            operation: scope.operation,
            publicScopeHash: hashValue(scope.publicScope),
            requestHash,
            status: 'IN_PROGRESS' as const,
          };

    try {
      const record = await this.prisma.idempotencyRecord.create({ data });
      return { ownsExecution: true, record };
    } catch (error) {
      if (!isUniqueConstraint(error)) {
        throw error;
      }
      const existing = await this.findExisting(scope, keyHash);
      if (!existing) {
        throw error;
      }
      if (existing.requestHash !== requestHash) {
        throw reusedKeyConflict();
      }
      if (
        existing.status === 'FAILED' ||
        isStale(existing, this.staleSeconds)
      ) {
        const restarted = await this.restart(existing, requestHash, expiresAt);
        if (restarted) {
          return { ownsExecution: true, record: restarted };
        }
      }
      return { ownsExecution: false, record: existing };
    }
  }

  private findExisting(scope: IdempotencyScope, keyHash: string) {
    if (scope.type === 'authenticated') {
      return this.prisma.idempotencyRecord.findFirst({
        where: {
          businessId: scope.businessId,
          keyHash,
          operation: scope.operation,
          userId: scope.userId,
        },
      });
    }

    return this.prisma.idempotencyRecord.findFirst({
      where: {
        keyHash,
        operation: scope.operation,
        publicScopeHash: hashValue(scope.publicScope),
      },
    });
  }

  private async restart(
    record: IdempotencyRecordSnapshot,
    requestHash: string,
    expiresAt: Date,
  ) {
    const updated = await this.prisma.idempotencyRecord.updateMany({
      data: {
        completedAt: null,
        errorCode: null,
        expiresAt,
        requestHash,
        responseBody: null as never,
        responseStatus: null,
        status: 'IN_PROGRESS',
      },
      where: {
        id: record.id,
        status: record.status,
        updatedAt: record.updatedAt,
      },
    });

    if (updated.count !== 1) {
      return undefined;
    }

    return this.prisma.idempotencyRecord.findFirstOrThrow({
      where: { id: record.id },
    });
  }

  private async resolveExisting<T>(
    record: IdempotencyRecordSnapshot,
    requestHash: string,
    scope: IdempotencyScope,
  ): Promise<T> {
    if (record.requestHash !== requestHash) {
      throw reusedKeyConflict();
    }

    if (record.status === 'SUCCESS') {
      return record.responseBody as T;
    }

    const deadline = Date.now() + Math.min(this.staleSeconds, 5) * 1000;
    let latest: IdempotencyRecordSnapshot | null = record;
    while (Date.now() < deadline) {
      await delay(75);
      latest = await this.findById(record.id);
      if (!latest) break;
      if (latest.requestHash !== requestHash) {
        throw reusedKeyConflict();
      }
      if (latest.status === 'SUCCESS') {
        return latest.responseBody as T;
      }
      if (latest.status === 'FAILED') {
        throw new ServiceUnavailableException({
          code: 'IDEMPOTENCY_ORIGINAL_REQUEST_FAILED',
          message:
            'The original request failed. Please retry with a new idempotency key.',
        });
      }
    }

    throw new ConflictException({
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      details: { operation: scope.operation },
      message:
        'A request with this idempotency key is still being processed. Please retry shortly.',
    });
  }

  private findById(id: string) {
    return this.prisma.idempotencyRecord.findFirst({
      where: { id },
    });
  }
}

function reusedKeyConflict() {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message:
      'This Idempotency-Key was already used with a different request payload.',
  });
}

function isUniqueConstraint(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function isStale(record: IdempotencyRecordSnapshot, staleSeconds: number) {
  return Date.now() - record.updatedAt.getTime() > staleSeconds * 1000;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

function errorCode(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof response.code === 'string'
    ) {
      return response.code;
    }
    return `HTTP_${error.getStatus()}`;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'UNKNOWN_ERROR';
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
