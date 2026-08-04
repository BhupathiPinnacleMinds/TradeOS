import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type {
  AppointmentTransitionAction,
  HealthResponse,
  MediaListResponse,
} from '@tradieos/shared';
import { APPOINTMENT_TRANSITION_ROUTE_SEGMENTS } from '@tradieos/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health endpoint (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:5432/tradieos_test';
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-local-tests';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $transaction: jest.fn((input: unknown[]) => Promise.all(input)),
        businessMember: {
          findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
        },
        appointment: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        mediaAsset: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        user: {
          findFirst: jest.fn().mockResolvedValue({
            businessId: 'business-1',
            email: 'owner@example.test',
            id: 'user-1',
            role: 'OWNER',
          }),
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    token = new JwtService({
      secret: process.env.JWT_SECRET,
    }).sign({ businessId: 'business-1', sub: 'user-1' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    const body = response.body as HealthResponse;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('tradieos-api');
  });

  it('GET /api/media is registered and returns an authorised empty list', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/media')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as MediaListResponse;
    expect(body.records).toEqual([]);
    expect(body.total).toBe(0);
  });

  it.each<AppointmentTransitionAction>([
    'confirm',
    'start-travel',
    'arrive',
    'start',
    'pause',
    'resume',
    'complete',
    'cancel',
  ])(
    'POST /api/appointments/:id/%s is registered and returns structured JSON',
    async (action) => {
      const segment = APPOINTMENT_TRANSITION_ROUTE_SEGMENTS[action];
      const response = await request(app.getHttpServer())
        .post(`/api/appointments/missing-appointment/${segment}`)
        .set('Authorization', `Bearer ${token}`)
        .send(action === 'complete' ? { workCompleted: 'Done' } : undefined)
        .expect(404);

      expect(response.type).toContain('json');
      expect(response.text).not.toContain('Cannot POST');
      expect(response.body).toMatchObject({
        code: 'APPOINTMENT_NOT_FOUND',
        message: 'Appointment not found.',
      });
    },
  );
});
