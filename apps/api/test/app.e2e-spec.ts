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
import { AppointmentsService } from '../src/appointments/appointments.service';
import { JobsService } from '../src/jobs/jobs.service';
import { PrismaService } from '../src/prisma/prisma.service';

function serializedToriContext(context: ToriChatResponse['context']) {
  return JSON.parse(
    JSON.stringify(context),
  ) as unknown as ToriChatResponse['context'];
}

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
        customer: {
          findFirst: jest.fn().mockResolvedValue({
            companyName: null,
            contactPreference: 'SMS',
            displayName: 'Ranjee',
            email: null,
            firstName: 'Ranjee',
            id: 'customer-1',
            lastName: null,
            phone: '0422462867',
            sites: [],
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              companyName: null,
              contactPreference: 'SMS',
              displayName: 'Ranjee',
              email: null,
              firstName: 'Ranjee',
              id: 'customer-1',
              lastName: null,
              phone: '0422462867',
              sites: [],
            },
          ]),
        },
        invoice: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { balanceDueCents: 0 } }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        job: {
          findFirst: jest.fn().mockResolvedValue({
            addressLine1: '27 Coffey Street',
            addressLine2: null,
            customer: { displayName: 'Ranjee', sites: [] },
            customerId: 'customer-1',
            id: 'job-1',
            jobNumber: 'JOB-2026-000028',
            postcode: '3029',
            state: 'VIC',
            suburb: 'Tarneit',
            title: 'Fix the leak',
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              addressLine1: '27 Coffey Street',
              addressLine2: null,
              customer: { displayName: 'Ranjee', sites: [] },
              customerId: 'customer-1',
              id: 'job-1',
              jobNumber: 'JOB-2026-000028',
              postcode: '3029',
              state: 'VIC',
              suburb: 'Tarneit',
              title: 'Fix the leak',
            },
          ]),
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

  it('POST /api/ai/tori/chat preserves appointment workflow context across separate HTTP requests', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Create an appointment' })
      .expect(201);

    const firstBody = first.body as ToriChatResponse;
    expect(firstBody.message.content).toContain('Which customer');
    expect(firstBody.context).toMatchObject({
      pendingAppointment: {},
      pendingQuestion: {
        intent: 'CREATE_APPOINTMENT_FOR_JOB',
        type: 'APPOINTMENT_CUSTOMER',
      },
    });

    const serializedContext = serializedToriContext(firstBody.context);

    const second = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedContext,
        message: 'Aug 20, 9:00AM',
      })
      .expect(201);

    const secondBody = second.body as ToriChatResponse;
    expect(secondBody.message.content).toContain('customer');
    expect(secondBody.message.content).not.toContain("can't prepare");
    expect(secondBody.context?.pendingQuestion?.type).toBe(
      'APPOINTMENT_CUSTOMER',
    );
  });

  it('POST /api/ai/tori/chat completes fresh appointment slot collection over serialized HTTP contexts', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Create an appointment' })
      .expect(201);
    const startBody = start.body as ToriChatResponse;

    const customer = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(startBody.context),
        message: 'Ranjee',
      })
      .expect(201);
    const customerBody = customer.body as ToriChatResponse;
    expect(customerBody.message.content).toContain('What date and time');

    const dateTime = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(customerBody.context),
        message: 'Aug 20, 9:00AM',
      })
      .expect(201);
    const dateTimeBody = dateTime.body as ToriChatResponse;
    expect(dateTimeBody.message.content).toContain('How long');

    const duration = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(dateTimeBody.context),
        message: '60 minutes',
      })
      .expect(201);
    const durationBody = duration.body as ToriChatResponse;

    expect(durationBody.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(durationBody.message.actionDraft?.payload.type).toBe(
      'CREATE_APPOINTMENT',
    );
  });

  it('POST /api/ai/tori/chat branches no-active-job appointment workflow into a serialized CREATE_JOB draft', async () => {
    const jobsService = app.get(JobsService);
    const appointmentsService = app.get(AppointmentsService);
    const prisma = app.get<{
      customer: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
      };
      job: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
      };
    }>(PrismaService);
    const ranjee = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjee',
      email: null,
      firstName: 'Ranjee',
      id: 'customer-1',
      lastName: null,
      phone: '0422462867',
      sites: [],
    };
    const createdJob = {
      accessInstructions: null,
      addressLine1: '27 Coffey Street',
      addressLine2: null,
      customer: {
        addressLine1: null,
        addressLine2: null,
        displayName: 'Ranjee',
        id: 'customer-1',
        postcode: null,
        sites: [],
        state: null,
        suburb: null,
      },
      customerId: 'customer-1',
      id: 'job-created',
      jobNumber: 'JOB-2026-000029',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix leaking kitchen tap',
    };
    const jobCreate = jest
      .spyOn(jobsService, 'create')
      .mockResolvedValue({ job: createdJob } as never);
    const appointmentCreate = jest
      .spyOn(appointmentsService, 'create')
      .mockResolvedValue({
        appointment: {
          appointmentNumber: 'APT-2026-000029',
          id: 'appointment-created',
          jobId: 'job-created',
          scheduledStart: new Date('2026-08-19T23:00:00.000Z'),
        },
      } as never);
    prisma.customer.findMany.mockResolvedValueOnce([ranjee]);
    prisma.customer.findFirst.mockResolvedValue(ranjee);
    prisma.job.findMany.mockResolvedValueOnce([]);
    prisma.job.findFirst.mockResolvedValue(createdJob);

    const start = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Create an appointment?' })
      .expect(201);
    const startBody = start.body as ToriChatResponse;

    const customer = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(startBody.context),
        message: 'Ranjee',
      })
      .expect(201);
    const customerBody = customer.body as ToriChatResponse;
    expect(customerBody.message.content).toContain(
      "there isn't an active job to schedule",
    );
    expect(customerBody.context?.pendingQuestion?.type).toBe('APPOINTMENT_JOB');

    const createJob = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(customerBody.context),
        message: 'Yeah, create a job',
      })
      .expect(201);
    const createJobBody = createJob.body as ToriChatResponse;
    expect(createJobBody.message.content).toContain('What is the job for');
    expect(createJobBody.context?.pendingQuestion?.intent).toBe('CREATE_JOB');

    const title = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(createJobBody.context),
        message: 'Fix leaking kitchen tap',
      })
      .expect(201);
    const titleBody = title.body as ToriChatResponse;
    expect(titleBody.message.content).toContain('service address');
    expect(titleBody.context?.pendingJob?.title).toBe(
      'Fix leaking kitchen tap',
    );

    const address = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(titleBody.context),
        message: '27 Coffey Street, Tarneit, 3029',
      })
      .expect(201);
    const addressBody = address.body as ToriChatResponse;
    expect(addressBody.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(addressBody.context?.pendingJob).toMatchObject({
      addressLine1: '27 Coffey Street',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix leaking kitchen tap',
    });
    expect(
      addressBody.message.actionDraft?.payload.type === 'CREATE_JOB'
        ? addressBody.message.actionDraft.payload.resumeAppointment?.customerId
        : undefined,
    ).toBe('customer-1');

    const jobDraft = addressBody.message.actionDraft;
    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');

    const confirmedJob = await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${jobDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: jobDraft })
      .expect(201);
    const confirmedJobBody = confirmedJob.body as {
      context?: ToriChatResponse['context'];
    };
    expect(jobCreate).toHaveBeenCalledTimes(1);
    expect(confirmedJobBody.context?.pendingAppointment).toMatchObject({
      jobId: 'job-created',
      serviceLocation: {
        addressLine1: '27 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      },
    });

    const dateTime = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(confirmedJobBody.context),
        message: 'Aug 20, 9:00AM',
      })
      .expect(201);
    const dateTimeBody = dateTime.body as ToriChatResponse;

    const duration = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(dateTimeBody.context),
        message: '60 minutes',
      })
      .expect(201);
    const durationBody = duration.body as ToriChatResponse;
    const appointmentDraft = durationBody.message.actionDraft;
    expect(appointmentDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(
      appointmentDraft?.payload.type === 'CREATE_APPOINTMENT'
        ? appointmentDraft.payload.appointmentPayload
        : undefined,
    ).toMatchObject({
      addressLine1: '27 Coffey Street',
      customerSiteId: null,
      locationSource: 'MANUAL',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
    });

    if (!appointmentDraft) {
      throw new Error('Expected CREATE_APPOINTMENT draft');
    }
    await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${appointmentDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: appointmentDraft })
      .expect(201);

    expect(appointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'business-1' }),
      expect.objectContaining({
        addressLine1: '27 Coffey Street',
        customerSiteId: null,
        locationSource: 'MANUAL',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      }),
    );
    expect(appointmentCreate).toHaveBeenCalledTimes(1);
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
