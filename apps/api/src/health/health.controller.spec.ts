import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController, ReadinessController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('returns the API health contract', () => {
    const response = controller.check();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('tradieos-api');
    expect(Number.isNaN(Date.parse(response.timestamp))).toBe(false);
  });

  it('does not require database access for liveness', () => {
    expect(controller.check()).toMatchObject({ status: 'ok' });
  });

  it('does not expose secrets in the liveness response', () => {
    const serialized = JSON.stringify(controller.check());

    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('JWT_SECRET');
    expect(serialized).not.toContain('password');
  });
});

describe('ReadinessController', () => {
  it('returns ready when the Prisma database check succeeds', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const controller = new ReadinessController(prisma as never);

    await expect(controller.check()).resolves.toEqual({ status: 'ready' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 503 not_ready when the Prisma database check fails', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockRejectedValue(new Error('database password leaked here')),
    };
    const controller = new ReadinessController(prisma as never);

    await expect(controller.check()).rejects.toMatchObject({
      response: { status: 'not_ready' },
      status: 503,
    });
  });

  it('does not expose raw Prisma/database errors in readiness failure responses', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockRejectedValue(new Error('Prisma failed at postgresql://secret')),
    };
    const controller = new ReadinessController(prisma as never);

    try {
      await controller.check();
      throw new Error('Expected readiness to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      const serialized = JSON.stringify(response);
      expect(response).toEqual({ status: 'not_ready' });
      expect(serialized).not.toContain('Prisma');
      expect(serialized).not.toContain('postgresql://');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('password');
    }
  });
});
