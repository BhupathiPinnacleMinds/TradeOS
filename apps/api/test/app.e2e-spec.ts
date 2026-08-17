import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type {
  AppointmentTransitionAction,
  CustomerCommunicationListResponse,
  HealthResponse,
  MediaListResponse,
  ToriChatResponse,
  ToriSnapshot,
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
          findMany: jest.fn().mockResolvedValue([
            {
              user: {
                email: 'mia@example.test',
                firstName: 'Mia',
                id: 'user-2',
                lastName: 'Nguyen',
              },
            },
          ]),
        },
        appointment: {
          count: jest.fn().mockResolvedValue(1),
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([
            {
              appointmentNumber: 'APT-2026-000001',
              assignedUser: {
                email: 'mia@example.test',
                firstName: 'Mia',
                lastName: 'Nguyen',
              },
              job: {
                customer: { displayName: 'RamaReddy' },
                title: 'Pipe leak',
              },
              scheduledEnd: new Date('2026-08-14T01:30:00.000Z'),
              scheduledStart: new Date('2026-08-14T00:30:00.000Z'),
            },
          ]),
        },
        business: {
          findUnique: jest.fn().mockResolvedValue({
            gstRegistered: true,
            id: 'business-1',
            name: 'Demo Tradie Co',
            timezone: 'Australia/Melbourne',
          }),
        },
        mediaAsset: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        invoice: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { balanceDueCents: 0 } }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        job: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        quote: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        customerCommunication: {
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

  it('GET /api/communications is registered and returns an authorised empty history', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/communications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.type).toContain('json');
    expect(response.text).not.toContain('Cannot GET');
    const body = response.body as CustomerCommunicationListResponse;
    expect(body.records).toEqual([]);
  });

  it('GET /api/ai/tori/summary is registered and returns structured JSON', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/ai/tori/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.type).toContain('json');
    expect(response.text).not.toContain('Cannot GET');
    const body = response.body as {
      snapshot: ToriSnapshot;
    };
    expect(body.snapshot.todayAppointments).toBe(1);
  });

  it('POST /api/ai/tori/chat is registered and returns a structured Tori response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: "What's happening today?" })
      .expect(201);

    expect(response.type).toContain('json');
    expect(response.text).not.toContain('Cannot POST');
    const body = response.body as ToriChatResponse;
    expect(body.message.role).toBe('assistant');
    expect(body.message.content).toContain('Appointments today');
  });

  it('POST /api/ai/tori/actions/:draftId/confirm is registered and returns structured JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/tori/actions/missing-draft/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: {
          expiresAt: '2099-01-01T00:00:00.000Z',
          id: 'missing-draft',
          payload: {
            appointmentId: 'missing-appointment',
            expectedUpdatedAt: '2099-01-01T00:00:00.000Z',
            type: 'CANCEL_APPOINTMENT',
          },
          type: 'CANCEL_APPOINTMENT',
        },
      })
      .expect(404);

    expect(response.type).toContain('json');
    expect(response.text).not.toContain('Cannot POST');
    expect(response.body).toMatchObject({
      code: 'TORI_ENTITY_NOT_FOUND',
      message: 'This appointment could not be found.',
    });
  });

  it('unsupported Tori endpoints return structured JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/tori/unsupported')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(404);

    expect(response.type).toContain('json');
    expect(response.text).not.toContain('Cannot POST');
    expect(response.body).toMatchObject({
      code: 'TORI_ENDPOINT_NOT_FOUND',
      message: 'That Tori endpoint is not available.',
    });
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
