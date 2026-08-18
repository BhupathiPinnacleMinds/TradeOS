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
import { CustomersService } from '../src/customers/customers.service';
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
        $transaction: jest.fn(
          (input: unknown[] | ((tx: unknown) => unknown)) =>
            Array.isArray(input)
              ? Promise.all(input)
              : input({
                  auditLog: { create: jest.fn() },
                  customerSite: {
                    create: jest.fn().mockResolvedValue({
                      accessInstructions: null,
                      addressLine1: '27 Coffey Street',
                      addressLine2: null,
                      createdAt: new Date('2026-08-18T00:00:00.000Z'),
                      customerId: 'customer-1',
                      id: 'site-created',
                      isArchived: false,
                      isPrimary: true,
                      label: 'Service address',
                      postcode: '3029',
                      siteContactName: null,
                      siteContactPhone: null,
                      state: 'VIC',
                      suburb: 'Tarneit',
                      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
                    }),
                    updateMany: jest.fn(),
                  },
                }),
        ),
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
        customerSite: {
          findMany: jest.fn().mockResolvedValue([]),
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

  it('POST /api/ai/tori/chat creates a job for a just-created customer through serialized context', async () => {
    const customersService = app.get(CustomersService);
    const jobsService = app.get(JobsService);
    const prisma = app.get<{
      customer: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
      };
    }>(PrismaService);
    const pooja = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Pooja',
      email: null,
      firstName: 'Pooja',
      id: 'customer-pooja',
      lastName: null,
      phone: '0450488583',
      sites: [],
    };
    const createdJob = {
      accessInstructions: null,
      addressLine1: '30 Coffey Street',
      addressLine2: null,
      customer: {
        addressLine1: null,
        addressLine2: null,
        displayName: 'Pooja',
        id: 'customer-pooja',
        postcode: null,
        sites: [],
        state: null,
        suburb: null,
      },
      customerId: 'customer-pooja',
      id: 'job-pooja-1',
      jobNumber: 'JOB-2026-000101',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Blocked kitchen sink',
    };
    const customerCreate = jest
      .spyOn(customersService, 'create')
      .mockResolvedValue({ customer: pooja } as never);
    const jobCreate = jest
      .spyOn(jobsService, 'create')
      .mockResolvedValue({ job: createdJob } as never);
    customerCreate.mockClear();
    jobCreate.mockClear();
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.findFirst.mockResolvedValue(pooja);

    const startCustomer = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Create customer' })
      .expect(201);
    const startCustomerBody = startCustomer.body as ToriChatResponse;

    const name = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(startCustomerBody.context),
        message: 'Pooja',
      })
      .expect(201);
    const nameBody = name.body as ToriChatResponse;

    const phone = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(nameBody.context),
        message: '0450488583',
      })
      .expect(201);
    const phoneBody = phone.body as ToriChatResponse;
    const customerDraft = phoneBody.message.actionDraft;
    expect(customerDraft?.type).toBe('CREATE_CUSTOMER');

    if (!customerDraft) throw new Error('Expected CREATE_CUSTOMER draft');
    const confirmedCustomer = await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${customerDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: customerDraft })
      .expect(201);
    const confirmedCustomerBody = confirmedCustomer.body as {
      context?: ToriChatResponse['context'];
    };
    expect(confirmedCustomerBody.context).toMatchObject({
      customerId: 'customer-pooja',
      customerName: 'Pooja',
      recentCustomer: {
        displayName: 'Pooja',
        id: 'customer-pooja',
      },
    });

    const createJob = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(confirmedCustomerBody.context),
        message: 'Create job for the newly created customer',
      })
      .expect(201);
    const createJobBody = createJob.body as ToriChatResponse;
    expect(createJobBody.message.content).toContain('What is the job for');
    expect(createJobBody.message.content).not.toContain("customer's name");
    expect(createJobBody.context?.pendingQuestion).toMatchObject({
      intent: 'CREATE_JOB',
      type: 'JOB_TITLE',
    });

    const title = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(createJobBody.context),
        message: 'Blocked kitchen sink',
      })
      .expect(201);
    const titleBody = title.body as ToriChatResponse;
    expect(titleBody.message.content).toContain('service address');

    const address = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(titleBody.context),
        message: '30 Coffey Street, Tarneit, 3029',
      })
      .expect(201);
    const addressBody = address.body as ToriChatResponse;
    const jobDraft = addressBody.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');
    expect(addressBody.message.content).not.toContain('service address');
    expect(
      jobDraft?.payload.type === 'CREATE_JOB'
        ? jobDraft.payload.jobPayload
        : undefined,
    ).toMatchObject({
      addressLine1: '30 Coffey Street',
      customerId: 'customer-pooja',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Blocked kitchen sink',
    });

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const confirmedJob = await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${jobDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: jobDraft })
      .expect(201);
    const confirmedJobBody = confirmedJob.body as {
      context?: ToriChatResponse['context'];
    };

    expect(customerCreate).toHaveBeenCalledTimes(1);
    expect(jobCreate).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'business-1' }),
      expect.objectContaining({
        customerId: 'customer-pooja',
        title: 'Blocked kitchen sink',
      }),
    );
    expect(jobCreate).toHaveBeenCalledTimes(1);
    expect(confirmedJobBody.context).toMatchObject({
      customerId: 'customer-pooja',
      customerName: 'Pooja',
      jobId: 'job-pooja-1',
      recentJob: {
        id: 'job-pooja-1',
        title: 'Blocked kitchen sink',
      },
    });

    customerCreate.mockRestore();
    jobCreate.mockRestore();
  });

  it('POST /api/ai/tori/chat orchestrates the exact Pooja dispatch request through confirmations', async () => {
    const customersService = app.get(CustomersService);
    const jobsService = app.get(JobsService);
    const appointmentsService = app.get(AppointmentsService);
    const prisma = app.get<{
      appointment: { findMany: jest.Mock };
      customer: { findFirst: jest.Mock; findMany: jest.Mock };
      job: { findFirst: jest.Mock };
    }>(PrismaService);
    const pooja = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Pooja',
      email: null,
      firstName: 'Pooja',
      id: 'customer-pooja-dispatch',
      lastName: null,
      phone: '0450488583',
      sites: [],
    };
    const createdJob = {
      accessInstructions: null,
      addressLine1: '30 Coffey Street',
      addressLine2: null,
      customer: {
        addressLine1: null,
        addressLine2: null,
        displayName: 'Pooja',
        id: 'customer-pooja-dispatch',
        postcode: null,
        sites: [],
        state: null,
        suburb: null,
      },
      customerId: 'customer-pooja-dispatch',
      id: 'job-pooja-dispatch',
      jobNumber: 'JOB-2026-000222',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Blocked kitchen sink',
    };
    const customerCreate = jest
      .spyOn(customersService, 'create')
      .mockResolvedValue({ customer: pooja } as never);
    const jobCreate = jest
      .spyOn(jobsService, 'create')
      .mockResolvedValue({ job: createdJob } as never);
    const appointmentCreate = jest
      .spyOn(appointmentsService, 'create')
      .mockResolvedValue({
        appointment: {
          appointmentNumber: 'APT-2026-000222',
          id: 'appointment-pooja-dispatch',
          jobId: 'job-pooja-dispatch',
          scheduledStart: new Date('2026-08-18T23:00:00.000Z'),
        },
      } as never);
    customerCreate.mockClear();
    jobCreate.mockClear();
    appointmentCreate.mockClear();
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.findFirst.mockResolvedValue(pooja);
    prisma.job.findFirst.mockResolvedValue(createdJob);

    const start = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        message:
          'I have a new customer Pooja. Her number is 0450488583. Her kitchen sink is blocked at 30 Coffey Street, Tarneit. Book someone tomorrow morning.',
      })
      .expect(201);
    const startBody = start.body as ToriChatResponse;
    expect(startBody.message.content).not.toContain(
      "couldn't find appointments for tomorrow",
    );
    expect(startBody.message.content).toContain('How long should I allow');
    expect(startBody.context?.pendingDispatch).toMatchObject({
      customer: { name: 'Pooja', phone: '0450488583' },
      job: {
        addressLine1: '30 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Blocked kitchen sink',
      },
      scheduling: { daypart: 'MORNING' },
    });

    const duration = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(startBody.context),
        message: '60 minutes',
      })
      .expect(201);
    const durationBody = duration.body as ToriChatResponse;
    const customerDraft = durationBody.message.actionDraft;
    expect(customerDraft?.type).toBe('CREATE_CUSTOMER');

    if (!customerDraft) throw new Error('Expected CREATE_CUSTOMER draft');
    const customerResult = await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${customerDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: customerDraft })
      .expect(201);
    const customerResultBody = customerResult.body as {
      nextMessage?: ToriChatResponse['message'];
    };
    const jobDraft = customerResultBody.nextMessage?.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${jobDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: jobDraft })
      .expect(201);
    const jobResultBody = jobResult.body as {
      message?: string;
      nextMessage?: ToriChatResponse['message'];
    };
    expect(jobResultBody.message).not.toContain(
      'Would you like me to prepare an appointment?',
    );
    expect(jobResultBody.message).toContain(
      "I'll check technician availability",
    );
    const appointmentDraft = jobResultBody.nextMessage?.actionDraft;
    expect(appointmentDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(jobResultBody.nextMessage?.content).toContain('available');

    if (!appointmentDraft) throw new Error('Expected CREATE_APPOINTMENT draft');
    await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${appointmentDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: appointmentDraft })
      .expect(201);

    expect(customerCreate).toHaveBeenCalledTimes(1);
    expect(jobCreate).toHaveBeenCalledTimes(1);
    expect(appointmentCreate).toHaveBeenCalledTimes(1);
    const appointmentCreatePayload = appointmentCreate.mock.calls[0]?.[1] as
      { assignedUserId?: unknown } | undefined;
    expect(typeof appointmentCreatePayload?.assignedUserId).toBe('string');
    expect(appointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'business-1' }),
      expect.objectContaining({
        addressLine1: '30 Coffey Street',
        jobId: 'job-pooja-dispatch',
        locationSource: 'MANUAL',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      }),
    );

    customerCreate.mockRestore();
    jobCreate.mockRestore();
    appointmentCreate.mockRestore();
  });

  it('POST /api/ai/tori/chat prioritises the exact Ben booking dispatch over tomorrow read lookup', async () => {
    const customersService = app.get(CustomersService);
    const jobsService = app.get(JobsService);
    const appointmentsService = app.get(AppointmentsService);
    const prisma = app.get<{
      appointment: { findMany: jest.Mock };
      customer: { findFirst: jest.Mock; findMany: jest.Mock };
      job: { findFirst: jest.Mock };
    }>(PrismaService);
    const ben = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ben',
      email: null,
      firstName: 'Ben',
      id: 'customer-ben-dispatch',
      lastName: null,
      phone: '0414303345',
      sites: [],
    };
    const createdJob = {
      accessInstructions: null,
      addressLine1: '27 Coffey Street',
      addressLine2: null,
      customer: {
        addressLine1: null,
        addressLine2: null,
        displayName: 'Ben',
        id: 'customer-ben-dispatch',
        postcode: null,
        sites: [],
        state: null,
        suburb: null,
      },
      customerId: 'customer-ben-dispatch',
      id: 'job-ben-dispatch',
      jobNumber: 'JOB-2026-000223',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Pergola tap is leaking',
    };
    const customerCreate = jest
      .spyOn(customersService, 'create')
      .mockResolvedValue({ customer: ben } as never);
    const jobCreate = jest
      .spyOn(jobsService, 'create')
      .mockResolvedValue({ job: createdJob } as never);
    const appointmentCreate = jest
      .spyOn(appointmentsService, 'create')
      .mockResolvedValue({
        appointment: {
          appointmentNumber: 'APT-2026-000223',
          id: 'appointment-ben-dispatch',
          jobId: 'job-ben-dispatch',
          scheduledStart: new Date('2026-08-18T23:00:00.000Z'),
        },
      } as never);
    customerCreate.mockClear();
    jobCreate.mockClear();
    appointmentCreate.mockClear();
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.findFirst.mockResolvedValue(ben);
    prisma.job.findFirst.mockResolvedValue(createdJob);

    const start = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: {
          customerId: 'customer-ranjan',
          customerName: 'Ranjan',
          jobId: 'job-ranjan',
          jobTitle: 'Front yard tap leak',
          recentCustomer: { displayName: 'Ranjan', id: 'customer-ranjan' },
          recentJob: {
            customerId: 'customer-ranjan',
            customerName: 'Ranjan',
            id: 'job-ranjan',
            jobNumber: 'JOB-2026-000444',
            title: 'Front yard tap leak',
          },
        },
        message:
          'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning for 120 minutes.',
      })
      .expect(201);
    const startBody = start.body as ToriChatResponse;
    expect(startBody.message.content).not.toContain('Appointments tomorrow');
    expect(startBody.message.content).not.toContain('How long should I allow');
    expect(startBody.message.actionDraft?.type).toBe('CREATE_CUSTOMER');
    expect(startBody.context?.pendingDispatch).toMatchObject({
      customer: { name: 'Ben', phone: '0414303345' },
      job: {
        addressLine1: '27 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap is leaking',
      },
      scheduling: {
        daypart: 'MORNING',
        durationMinutes: 120,
      },
    });

    const customerDraft = startBody.message.actionDraft;
    if (!customerDraft) throw new Error('Expected CREATE_CUSTOMER draft');
    const customerResult = await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${customerDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: customerDraft })
      .expect(201);
    const customerResultBody = customerResult.body as {
      nextMessage?: ToriChatResponse['message'];
    };
    const jobDraft = customerResultBody.nextMessage?.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${jobDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: jobDraft })
      .expect(201);
    const jobResultBody = jobResult.body as {
      nextMessage?: ToriChatResponse['message'];
    };
    const appointmentDraft = jobResultBody.nextMessage?.actionDraft;
    expect(appointmentDraft?.type).toBe('CREATE_APPOINTMENT');

    if (!appointmentDraft) throw new Error('Expected CREATE_APPOINTMENT draft');
    await request(app.getHttpServer())
      .post(`/api/ai/tori/actions/${appointmentDraft.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draft: appointmentDraft })
      .expect(201);

    expect(customerCreate).toHaveBeenCalledTimes(1);
    expect(jobCreate).toHaveBeenCalledTimes(1);
    expect(appointmentCreate).toHaveBeenCalledTimes(1);
    expect(appointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'business-1' }),
      expect.objectContaining({
        addressLine1: '27 Coffey Street',
        estimatedDurationMinutes: 120,
        jobId: 'job-ben-dispatch',
        locationSource: 'MANUAL',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      }),
    );

    customerCreate.mockRestore();
    jobCreate.mockRestore();
    appointmentCreate.mockRestore();
  });

  it('POST /api/ai/tori/chat keeps parsed Ranjan dispatch context across HTTP round trips', async () => {
    const prisma = app.get<{
      customer: { findMany: jest.Mock };
    }>(PrismaService);
    prisma.customer.findMany.mockResolvedValue([]);

    const start = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        message:
          'I have a new customer Ranjan. His number is 0450588583. Her master bed bath leak at 29 Coffey Street, Tarneit, 3029 VIC. Book someone for tomorrow',
      })
      .expect(201);
    const startBody = start.body as ToriChatResponse;
    expect(startBody.message.content).not.toContain(
      "couldn't find appointments for tomorrow",
    );
    expect(startBody.message.content).toContain('How long should I allow');
    expect(startBody.context?.pendingDispatch).toMatchObject({
      customer: { name: 'Ranjan', phone: '0450588583' },
      job: {
        addressLine1: '29 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Master bedroom/bathroom leak',
      },
    });

    const duration = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: serializedToriContext(startBody.context),
        message: '120 mins',
      })
      .expect(201);
    const durationBody = duration.body as ToriChatResponse;
    expect(durationBody.message.actionDraft?.type).toBe('CREATE_CUSTOMER');
    expect(durationBody.context?.pendingDispatch?.customer.name).toBe('Ranjan');
    expect(
      durationBody.context?.pendingDispatch?.scheduling.durationMinutes,
    ).toBe(120);
  });

  it('POST /api/ai/tori/chat lets explicit Ranjan request override stale Ben HTTP context', async () => {
    const prisma = app.get<{
      customer: { findFirst: jest.Mock; findMany: jest.Mock };
      job: { findMany: jest.Mock };
    }>(PrismaService);
    const ranjan = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjan',
      email: null,
      firstName: 'Ranjan',
      id: 'customer-ranjan',
      lastName: null,
      phone: '0450588583',
      sites: [
        {
          accessInstructions: null,
          addressLine1: '29 Coffey Street',
          addressLine2: null,
          id: 'site-ranjan',
          isPrimary: true,
          label: 'Home',
          postcode: '3029',
          state: 'VIC',
          suburb: 'Tarneit',
        },
      ],
    };
    prisma.customer.findMany.mockResolvedValue([ranjan]);
    prisma.customer.findFirst.mockResolvedValue(ranjan);
    prisma.job.findMany.mockResolvedValue([]);

    const response = await request(app.getHttpServer())
      .post('/api/ai/tori/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        context: {
          customerId: 'customer-ben',
          customerName: 'Ben',
          jobId: 'job-ben',
          jobTitle: 'Fix leak',
          recentCustomer: { displayName: 'Ben', id: 'customer-ben' },
          recentJob: {
            customerId: 'customer-ben',
            customerName: 'Ben',
            id: 'job-ben',
            jobNumber: 'JOB-2026-000333',
            title: 'Fix leak',
          },
        },
        message:
          'Create an appointment for Ranjan for front yard tap leak for Aug 21 please',
      })
      .expect(201);
    const body = response.body as ToriChatResponse;

    expect(body.message.content).not.toContain('Ben');
    expect(body.message.content).not.toContain('What date');
    expect(body.context?.pendingDispatch).toMatchObject({
      customer: {
        customerId: 'customer-ranjan',
        name: 'Ranjan',
      },
      job: { title: 'Front yard tap leak' },
    });
    expect(body.context?.pendingDispatch?.scheduling.date).toMatch(
      /^\d{4}-08-21$/,
    );
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
