import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser, ToriActionDraft } from '@tradieos/shared';
import { AiProvider } from './ai-provider';
import { AiService } from './ai.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.com',
  id: 'owner-1',
  role: 'OWNER',
};

const readOnly: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'readonly@example.com',
  id: 'readonly-1',
  role: 'READ_ONLY',
};

function appointment() {
  return {
    accessInstructions: null,
    addressLine1: '1 Main Street',
    addressLine2: null,
    appointmentNumber: 'APT-2026-000001',
    appointmentType: 'INSPECTION',
    assignedUser: {
      email: 'mia@demo-tradieos.com',
      firstName: 'Mia',
      id: 'mia-1',
      lastName: 'Nguyen',
    },
    assignedUserId: 'mia-1',
    businessId: 'business-1',
    customerSiteId: null,
    estimatedDurationMinutes: 60,
    id: 'appointment-1',
    job: {
      customer: { displayName: 'RamaReddy' },
      title: 'Pipe leak',
    },
    jobId: 'job-1',
    locationSource: 'CUSTOMER_DEFAULT',
    notes: null,
    postcode: '3000',
    scheduledEnd: new Date('2026-08-15T04:00:00.000Z'),
    scheduledStart: new Date('2026-08-15T03:00:00.000Z'),
    state: 'VIC',
    status: 'CONFIRMED',
    suburb: 'Melbourne',
    travelDistanceKm: null,
    travelDurationMinutes: null,
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
  };
}

function createPrisma() {
  return {
    appointment: {
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(appointment()),
      findMany: jest.fn().mockResolvedValue([appointment()]),
    },
    business: {
      findUnique: jest.fn().mockResolvedValue({
        gstRegistered: true,
        id: 'business-1',
        name: 'Demo Tradie Co',
        timezone: 'Australia/Melbourne',
      }),
    },
    businessMember: {
      findMany: jest.fn().mockResolvedValue([
        {
          role: 'TECHNICIAN',
          status: 'ACTIVE',
          user: {
            email: 'mia@demo-tradieos.com',
            firstName: 'Mia',
            id: 'mia-1',
            lastName: 'Nguyen',
          },
          userId: 'mia-1',
        },
      ]),
    },
    customer: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoice: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { balanceDueCents: 0 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    job: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    quote: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function service(prisma = createPrisma()) {
  const provider: AiProvider = {
    status: () => ({
      configured: true,
      message: 'Local deterministic Tori mode.',
      mode: 'LOCAL_DETERMINISTIC',
      model: null,
    }),
  };
  const appointments = {
    availability: jest.fn().mockResolvedValue({
      canOverride: false,
      conflicts: [],
      hasConflict: false,
      reason: 'No conflict',
    }),
    create: jest.fn(),
    reassign: jest.fn(),
    transition: jest.fn(),
    update: jest.fn(),
  };
  const communications = { sendManual: jest.fn() };
  const customers = { create: jest.fn() };
  const jobs = { create: jest.fn() };
  const quotes = { create: jest.fn() };
  const invoices = { create: jest.fn() };
  return {
    appointments,
    communications,
    customers,
    invoices,
    jobs,
    service: new AiService(
      prisma as never,
      provider,
      appointments as never,
      communications as never,
      customers as never,
      jobs as never,
      quotes as never,
      invoices as never,
    ),
  };
}

describe('AiService', () => {
  it('answers read questions with tenant-scoped appointment queries', async () => {
    const prisma = createPrisma();
    const { service: ai } = service(prisma);

    await ai.chat(owner, { message: "What's happening today?" });

    const findMany = prisma.appointment.findMany as jest.MockedFunction<
      (input: { where?: { businessId?: string } }) => Promise<unknown>
    >;
    const firstCall = findMany.mock.calls[0]?.[0];
    expect(firstCall.where?.businessId).toBe('business-1');
  });

  it('does not map unknown action prompts to today appointments', async () => {
    const prisma = createPrisma();
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      message: 'Can you please create a customer and job to fix the leak?',
    });

    expect(response.message.content).toContain("customer's name");
    expect(response.message.content).not.toContain('Appointments today');
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('returns a truthful unsupported response for unknown prompts', async () => {
    const prisma = createPrisma();
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      message: 'Can you order me lunch?',
    });

    expect(response.message.content).toContain("can't prepare that action yet");
    expect(response.message.content).not.toContain('Appointments today');
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('uses consistent unassigned appointment semantics for snapshot and read query', async () => {
    const prisma = createPrisma();
    const { service: ai } = service(prisma);

    await ai.summary(owner);
    await ai.chat(owner, { message: 'Show unassigned appointments.' });

    const countCalls = prisma.appointment.count.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    const findManyCalls = prisma.appointment.findMany.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    const countWhere = countCalls[1][0].where;
    const readWhere = findManyCalls[0][0].where;
    expect(countWhere.assignedUserId).toBeNull();
    expect(readWhere.assignedUserId).toBeNull();
    expect(countWhere.scheduledStart).toEqual(readWhere.scheduledStart);
    expect(countWhere.businessId).toBe('business-1');
    expect(readWhere.businessId).toBe('business-1');
  });

  it('creates an action draft without mutating appointment data', async () => {
    const { appointments, service: ai } = service();

    const response = await ai.chat(owner, {
      context: { appointmentId: 'appointment-1' },
      message: "Move Mia's appointment tomorrow to 4pm",
    });

    expect(response.message.actionDraft?.type).toBe('RESCHEDULE_APPOINTMENT');
    expect(response.message.actionDraft?.requiresConfirmation).toBe(true);
    expect(appointments.update).not.toHaveBeenCalled();
  });

  it('routes create customer requests to a customer action and asks for missing fields', async () => {
    const { customers, service: ai } = service();

    const response = await ai.chat(owner, {
      message: 'Create customer John Smith',
    });

    expect(response.message.content).toContain('phone number or email');
    expect(response.message.actionDraft).toBeUndefined();
    expect(customers.create).not.toHaveBeenCalled();
  });

  it('prepares a customer draft without creating the customer before confirm', async () => {
    const { customers, service: ai } = service();

    const response = await ai.chat(owner, {
      message: 'Create customer John Smith phone 0412 345 678',
    });

    expect(response.message.actionDraft?.type).toBe('CREATE_CUSTOMER');
    expect(response.message.actionDraft?.requiresConfirmation).toBe(true);
    expect(customers.create).not.toHaveBeenCalled();
  });

  it('confirms customer creation through the existing customer service', async () => {
    const { customers, service: ai } = service();
    customers.create.mockResolvedValue({
      customer: {
        displayName: 'John Smith',
        id: 'customer-1',
        phone: '0412 345 678',
      },
    });
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'draft-1',
      payload: {
        customerPayload: {
          contactPreference: 'PHONE',
          customerType: 'RESIDENTIAL',
          firstName: 'John',
          lastName: 'Smith',
          phone: '0412 345 678',
        },
        type: 'CREATE_CUSTOMER',
      },
      type: 'CREATE_CUSTOMER',
    } as ToriActionDraft;

    const result = await ai.confirm(owner, 'draft-1', draft);

    expect(customers.create).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ firstName: 'John' }),
    );
    expect(result.entityType).toBe('CUSTOMER');
    expect(result.entityId).toBe('customer-1');
  });

  it('warns about likely duplicate customers before confirmation', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValueOnce([
      {
        displayName: 'Existing John',
        email: null,
        phone: '0412 345 678',
      },
    ]);
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      message: 'Create customer John Smith phone 0412 345 678',
    });

    expect(response.message.actionDraft?.validationState).toBe('CONFLICT');
    expect(response.message.actionDraft?.warnings[0]).toContain(
      'Possible duplicate',
    );
  });

  it('requires clarification for ambiguous job customers', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValueOnce([
      { displayName: 'John Smith', sites: [] },
      { displayName: 'John Smith Plumbing', sites: [] },
    ]);
    const { jobs, service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      message: 'Create a job for John Smith to fix the leak',
    });

    expect(response.message.content).toContain('Which one do you mean');
    expect(response.message.actionDraft).toBeUndefined();
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('prepares a job draft for an existing customer without creating before confirm', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValueOnce([
      {
        contactPreference: 'SMS',
        displayName: 'Bethell',
        email: null,
        id: 'customer-1',
        phone: '0412 345 678',
        sites: [
          {
            addressLine1: '10 Example Street',
            id: 'site-1',
            isPrimary: true,
            label: 'Home',
            postcode: '3029',
            state: 'VIC',
            suburb: 'Tarneit',
          },
        ],
      },
    ]);
    const { jobs, service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      message: 'Create a job for Bethell to fix the leaking pipe',
    });

    expect(response.message.actionDraft?.type).toBe('CREATE_JOB');
    const appointmentChange =
      response.message.actionDraft?.proposedChanges.find(
        (change) => change.label === 'Appointment',
      );
    expect(appointmentChange?.to).toContain('Not created');
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('confirms job creation through the existing job service', async () => {
    const { jobs, service: ai } = service();
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '10 Example Street',
        customer: { displayName: 'Bethell', id: 'customer-1' },
        customerId: 'customer-1',
        id: 'job-1',
        jobNumber: 'JOB-2026-000001',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Fix leak',
      },
    });
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'draft-1',
      payload: {
        jobPayload: {
          addressLine1: '10 Example Street',
          customerId: 'customer-1',
          postcode: '3029',
          priority: 'NORMAL',
          scheduledStart: '2026-08-14T22:00:00.000Z',
          state: 'VIC',
          status: 'NEW',
          suburb: 'Tarneit',
          title: 'Fix leak',
        },
        type: 'CREATE_JOB',
      },
      type: 'CREATE_JOB',
    } as ToriActionDraft;

    const result = await ai.confirm(owner, 'draft-1', draft);

    expect(jobs.create).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ customerId: 'customer-1', title: 'Fix leak' }),
    );
    expect(result.message).toContain('No appointment was created');
  });

  it('gathers missing compound customer and job fields before drafting', async () => {
    const { jobs, service: ai } = service();

    const response = await ai.chat(owner, {
      message: 'Can you create a customer and job to fix a leaking tap?',
    });

    expect(response.message.content).toContain("customer's name");
    expect(response.message.actionDraft).toBeUndefined();
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('prepares a compound customer and job draft without mutating before confirm', async () => {
    const { jobs, service: ai } = service();

    const response = await ai.chat(owner, {
      message:
        'Create a customer and job to fix a leaking tap David Smith 0412 345 678 10 Example Street, Tarneit VIC 3029',
    });

    expect(response.message.actionDraft?.type).toBe('CREATE_CUSTOMER_AND_JOB');
    expect(response.message.actionDraft?.requiresConfirmation).toBe(true);
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('confirms compound customer and job through the existing quick-customer job service transaction', async () => {
    const { jobs, service: ai } = service();
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '10 Example Street',
        customer: { displayName: 'David Smith', id: 'customer-1' },
        customerId: 'customer-1',
        id: 'job-1',
        jobNumber: 'JOB-2026-000002',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Fix leaking tap',
      },
    });
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'draft-1',
      payload: {
        jobPayload: {
          addressLine1: '10 Example Street',
          postcode: '3029',
          priority: 'NORMAL',
          quickCustomer: {
            addressLine1: '10 Example Street',
            name: 'David Smith',
            phone: '0412 345 678',
            postcode: '3029',
            state: 'VIC',
            suburb: 'Tarneit',
          },
          scheduledStart: '2026-08-14T22:00:00.000Z',
          state: 'VIC',
          status: 'NEW',
          suburb: 'Tarneit',
          title: 'Fix leaking tap',
        },
        type: 'CREATE_CUSTOMER_AND_JOB',
      },
      type: 'CREATE_CUSTOMER_AND_JOB',
    } as ToriActionDraft;

    const result = await ai.confirm(owner, 'draft-1', draft);

    const createCalls = jobs.create.mock.calls as Array<
      [AuthenticatedUser, { quickCustomer?: { name?: string } }]
    >;
    expect(createCalls[0][0]).toBe(owner);
    expect(createCalls[0][1].quickCustomer?.name).toBe('David Smith');
    expect(result.message).toContain('Customer and job created');
    expect(result.context).toMatchObject({
      customerId: 'customer-1',
      customerName: 'David Smith',
      jobId: 'job-1',
      pendingQuestion: {
        intent: 'CREATE_APPOINTMENT_FOR_JOB',
        type: 'YES_NO',
      },
    });
  });

  it('uses post-confirm context so yes starts appointment scheduling instead of restarting customer and job', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValueOnce({
      addressLine1: '27 Coffey Street',
      addressLine2: null,
      customer: { displayName: 'David Smith', sites: [] },
      customerId: 'customer-1',
      id: 'job-1',
      jobNumber: 'JOB-2026-000028',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix the leak',
    });
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: {
        customerId: 'customer-1',
        customerName: 'David Smith',
        jobId: 'job-1',
        jobNumber: 'JOB-2026-000028',
        jobTitle: 'Fix the leak',
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'YES_NO',
        },
      },
      message: 'Yes please',
    });

    expect(response.message.content).toContain('What date');
    expect(response.message.content).toContain('David Smith');
    expect(response.message.content).not.toContain("customer's name");
    expect(response.context?.pendingQuestion?.type).toBe('APPOINTMENT_DATE');
  });

  it('treats no after an appointment offer as contextual refusal without drafting', async () => {
    const { service: ai } = service();

    const response = await ai.chat(owner, {
      context: {
        jobId: 'job-1',
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'YES_NO',
        },
      },
      message: 'No thanks',
    });

    expect(response.message.content).toContain('No appointment was created');
    expect(response.message.actionDraft).toBeUndefined();
    expect(response.context?.pendingQuestion).toBeUndefined();
  });

  it('lets explicit typo appointment intent interrupt stale customer and job slot collection', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValueOnce({
      addressLine1: '27 Coffey Street',
      addressLine2: null,
      customer: { displayName: 'David Smith', sites: [] },
      customerId: 'customer-1',
      id: 'job-1',
      jobNumber: 'JOB-2026-000028',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix the leak',
    });
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: {
        customerId: 'customer-1',
        customerName: 'David Smith',
        jobId: 'job-1',
        jobNumber: 'JOB-2026-000028',
        jobTitle: 'Fix the leak',
      },
      message: 'Crean an appointment',
      recentMessages: [
        {
          content: 'What phone number should I use for the customer?',
          role: 'assistant',
        },
      ],
    });

    expect(response.message.content).toContain('What date');
    expect(response.message.content).not.toContain('phone number');
  });

  it('does not consume read intents or unrelated text as pending slot data', async () => {
    const prisma = createPrisma();
    const { service: ai } = service(prisma);

    const readResponse = await ai.chat(owner, {
      message: 'Show my appointments today',
      recentMessages: [
        {
          content: 'What phone number should I use for the customer?',
          role: 'assistant',
        },
      ],
    });
    expect(readResponse.message.content).toContain('Appointments today');

    const unrelatedResponse = await ai.chat(owner, {
      message: 'Order me a pizza',
      recentMessages: [
        {
          content: 'What is the service address for this job?',
          role: 'assistant',
        },
      ],
    });
    expect(unrelatedResponse.message.content).toContain("can't help");
    expect(unrelatedResponse.message.actionDraft).toBeUndefined();
  });

  it('collects appointment date, time and duration before creating an appointment draft', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValue({
      addressLine1: '27 Coffey Street',
      addressLine2: null,
      customer: { displayName: 'David Smith', sites: [] },
      customerId: 'customer-1',
      id: 'job-1',
      jobNumber: 'JOB-2026-000028',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix the leak',
    });
    const { appointments, service: ai } = service(prisma);

    const dateResponse = await ai.chat(owner, {
      context: {
        pendingAppointment: {
          customerId: 'customer-1',
          customerName: 'David Smith',
          jobId: 'job-1',
          jobNumber: 'JOB-2026-000028',
          jobTitle: 'Fix the leak',
        },
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'APPOINTMENT_DATE',
        },
      },
      message: 'Tomorrow',
    });
    expect(dateResponse.message.content).toContain('start time');

    const timeResponse = await ai.chat(owner, {
      context: dateResponse.context,
      message: '10am',
    });
    expect(timeResponse.message.content).toContain('How long');

    const draftResponse = await ai.chat(owner, {
      context: timeResponse.context,
      message: '60 minutes',
    });

    expect(draftResponse.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(draftResponse.message.actionDraft?.proposedChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Customer', to: 'David Smith' }),
        expect.objectContaining({
          label: 'Job',
          to: 'JOB-2026-000028 — Fix the leak',
        }),
        expect.objectContaining({
          label: 'Location',
          to: '27 Coffey Street, Tarneit, VIC, 3029',
        }),
      ]),
    );
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it('continues an existing appointment workflow when combined natural date and time are provided', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValue({
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
    });
    const { appointments, service: ai } = service(prisma);

    const dateTimeResponse = await ai.chat(owner, {
      context: {
        customerId: 'customer-1',
        customerName: 'Ranjee',
        jobId: 'job-1',
        jobNumber: 'JOB-2026-000028',
        jobTitle: 'Fix the leak',
        pendingAppointment: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
          jobId: 'job-1',
          jobNumber: 'JOB-2026-000028',
          jobTitle: 'Fix the leak',
        },
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'APPOINTMENT_DATE',
        },
      },
      message: 'Aug 20 9:00am',
    });

    expect(dateTimeResponse.message.content).toContain('How long');
    expect(dateTimeResponse.context?.pendingAppointment).toMatchObject({
      date: '2026-08-20',
      time: '09:00',
    });

    const draftResponse = await ai.chat(owner, {
      context: dateTimeResponse.context,
      message: '60 minutes',
    });

    expect(draftResponse.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(
      draftResponse.message.actionDraft?.payload.type === 'CREATE_APPOINTMENT'
        ? draftResponse.message.actionDraft.payload.appointmentPayload
            .scheduledStart
        : undefined,
    ).toBe('2026-08-19T23:00:00.000Z');
    expect(draftResponse.message.actionDraft?.proposedChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Customer', to: 'Ranjee' }),
        expect.objectContaining({
          label: 'Job',
          to: 'JOB-2026-000028 \u2014 Fix the leak',
        }),
        expect.objectContaining({
          label: 'Location',
          to: '27 Coffey Street, Tarneit, VIC, 3029',
        }),
      ]),
    );
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it.each(['Tomorrow at 9am', '20 August at 9am', '20 Aug 9am'])(
    'accepts natural appointment date/time input: %s',
    async (message) => {
      const prisma = createPrisma();
      prisma.job.findFirst.mockResolvedValue({
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
      });
      const { service: ai } = service(prisma);

      const response = await ai.chat(owner, {
        context: {
          pendingAppointment: {
            customerId: 'customer-1',
            customerName: 'Ranjee',
            jobId: 'job-1',
            jobNumber: 'JOB-2026-000028',
            jobTitle: 'Fix the leak',
          },
          pendingQuestion: {
            intent: 'CREATE_APPOINTMENT_FOR_JOB',
            type: 'APPOINTMENT_DATE',
          },
        },
        message,
      });

      expect(response.message.content).toContain('How long');
      expect(response.context?.pendingAppointment?.date).toBeDefined();
      expect(response.context?.pendingAppointment?.time).toBe('09:00');
    },
  );

  it('supports appointment date and time supplied separately', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValue({
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
    });
    const { service: ai } = service(prisma);

    const dateResponse = await ai.chat(owner, {
      context: {
        pendingAppointment: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
          jobId: 'job-1',
          jobNumber: 'JOB-2026-000028',
          jobTitle: 'Fix the leak',
        },
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'APPOINTMENT_DATE',
        },
      },
      message: 'Aug 20',
    });

    expect(dateResponse.message.content).toContain('start time');
    expect(dateResponse.context?.pendingAppointment?.date).toBe('2026-08-20');

    const timeResponse = await ai.chat(owner, {
      context: dateResponse.context,
      message: '9am',
    });

    expect(timeResponse.message.content).toContain('How long');
    expect(timeResponse.context?.pendingAppointment?.time).toBe('09:00');
  });

  it('preserves appointment workflow context after invalid date/time input', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValue({
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
    });
    const { service: ai } = service(prisma);
    const context = {
      customerId: 'customer-1',
      customerName: 'Ranjee',
      jobId: 'job-1',
      jobNumber: 'JOB-2026-000028',
      jobTitle: 'Fix the leak',
      pendingAppointment: {
        customerId: 'customer-1',
        customerName: 'Ranjee',
        jobId: 'job-1',
        jobNumber: 'JOB-2026-000028',
        jobTitle: 'Fix the leak',
      },
      pendingQuestion: {
        intent: 'CREATE_APPOINTMENT_FOR_JOB',
        type: 'APPOINTMENT_DATE',
      },
    } as const;

    const invalidResponse = await ai.chat(owner, {
      context,
      message: 'Order me a pizza',
    });

    expect(invalidResponse.message.content).toContain('need a date');
    expect(invalidResponse.message.actionDraft).toBeUndefined();
    expect(invalidResponse.context?.pendingAppointment?.jobId).toBe('job-1');

    const validResponse = await ai.chat(owner, {
      context: invalidResponse.context,
      message: 'Aug 20 9:00am',
    });

    expect(validResponse.message.content).toContain('How long');
    expect(validResponse.context?.pendingAppointment).toMatchObject({
      customerName: 'Ranjee',
      date: '2026-08-20',
      jobId: 'job-1',
      time: '09:00',
    });
  });

  it('preserves previous job context across unsupported text before scheduling the above job', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValue({
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
    });
    const { service: ai } = service(prisma);

    const unsupported = await ai.chat(owner, {
      context: {
        customerId: 'customer-1',
        customerName: 'Ranjee',
        jobId: 'job-1',
        jobNumber: 'JOB-2026-000028',
        jobTitle: 'Fix the leak',
      },
      message: 'Piza',
    });
    expect(unsupported.context?.jobId).toBe('job-1');

    const start = await ai.chat(owner, {
      context: unsupported.context,
      message: 'Create an appointment for the above',
    });

    expect(start.message.content).toContain('What date');
    expect(start.context?.pendingAppointment?.jobId).toBe('job-1');

    const dateTime = await ai.chat(owner, {
      context: start.context,
      message: 'Aug 20 9:00am',
    });
    const draft = await ai.chat(owner, {
      context: dateTime.context,
      message: '60 minutes',
    });

    expect(draft.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(draft.message.actionDraft?.proposedChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Customer', to: 'Ranjee' }),
        expect.objectContaining({
          label: 'Job',
          to: 'JOB-2026-000028 \u2014 Fix the leak',
        }),
      ]),
    );
  });

  it('confirms a Tori-created appointment draft exactly once', async () => {
    const { appointments, service: ai } = service();
    appointments.create.mockResolvedValue({
      appointment: {
        appointmentNumber: 'APT-2026-000009',
        id: 'appointment-9',
        jobId: 'job-1',
        scheduledStart: new Date('2026-08-19T23:00:00.000Z'),
      },
    });
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'appointment-draft-once',
      payload: {
        appointmentPayload: {
          addressLine1: '27 Coffey Street',
          appointmentType: 'INSPECTION',
          estimatedDurationMinutes: 60,
          jobId: 'job-1',
          locationSource: 'CUSTOMER_DEFAULT',
          postcode: '3029',
          scheduledEnd: '2026-08-20T00:00:00.000Z',
          scheduledStart: '2026-08-19T23:00:00.000Z',
          state: 'VIC',
          suburb: 'Tarneit',
        },
        type: 'CREATE_APPOINTMENT',
      },
      type: 'CREATE_APPOINTMENT',
    } as ToriActionDraft;

    const result = await ai.confirm(owner, draft.id, draft);

    expect(result.status).toBe('COMPLETED');
    expect(result.entityId).toBe('appointment-9');
    expect(appointments.create).toHaveBeenCalledTimes(1);
    await expect(ai.confirm(owner, draft.id, draft)).rejects.toMatchObject({
      status: 409,
    });
    expect(appointments.create).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid appointment date and duration slot values with clarification', async () => {
    const prisma = createPrisma();
    prisma.job.findFirst.mockResolvedValue({
      addressLine1: '27 Coffey Street',
      addressLine2: null,
      customer: { displayName: 'David Smith', sites: [] },
      customerId: 'customer-1',
      id: 'job-1',
      jobNumber: 'JOB-2026-000028',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix the leak',
    });
    const { service: ai } = service(prisma);

    const invalidDate = await ai.chat(owner, {
      context: {
        pendingAppointment: { jobId: 'job-1' },
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'APPOINTMENT_DATE',
        },
      },
      message: 'Order me a pizza',
    });
    expect(invalidDate.message.content).toContain('need a date');
    expect(invalidDate.message.actionDraft).toBeUndefined();

    const invalidDuration = await ai.chat(owner, {
      context: {
        pendingAppointment: {
          date: '2026-08-18',
          jobId: 'job-1',
          time: '10:00',
        },
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'APPOINTMENT_DURATION',
        },
      },
      message: 'forever',
    });
    expect(invalidDuration.message.content).toContain('How long');
    expect(invalidDuration.message.actionDraft).toBeUndefined();
  });

  it('prevents confirming the same draft twice in one API process', async () => {
    const { jobs, service: ai } = service();
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '10 Example Street',
        customer: { displayName: 'David Smith', id: 'customer-1' },
        customerId: 'customer-1',
        id: 'job-1',
        jobNumber: 'JOB-2026-000002',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Fix leaking tap',
      },
    });
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'draft-once',
      payload: {
        jobPayload: {
          addressLine1: '10 Example Street',
          postcode: '3029',
          priority: 'NORMAL',
          quickCustomer: {
            addressLine1: '10 Example Street',
            name: 'David Smith',
            phone: '0412 345 678',
            postcode: '3029',
            state: 'VIC',
            suburb: 'Tarneit',
          },
          scheduledStart: '2026-08-14T22:00:00.000Z',
          state: 'VIC',
          status: 'NEW',
          suburb: 'Tarneit',
          title: 'Fix leaking tap',
        },
        type: 'CREATE_CUSTOMER_AND_JOB',
      },
      type: 'CREATE_CUSTOMER_AND_JOB',
    } as ToriActionDraft;

    await ai.confirm(owner, 'draft-once', draft);
    await expect(ai.confirm(owner, 'draft-once', draft)).rejects.toMatchObject({
      status: 409,
    });
    expect(jobs.create).toHaveBeenCalledTimes(1);
  });

  it('keeps customer name across multi-turn customer slot collection', async () => {
    const { customers, service: ai } = service();

    const nameResponse = await ai.chat(owner, {
      context: {
        pendingCustomer: {},
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER',
          type: 'CUSTOMER_NAME',
        },
      },
      message: 'David',
    });
    expect(nameResponse.message.content).toContain('phone number or email');
    expect(nameResponse.context?.pendingCustomer?.firstName).toBe('David');

    const draftResponse = await ai.chat(owner, {
      context: nameResponse.context,
      message: '0414303343',
    });

    expect(draftResponse.message.actionDraft?.type).toBe('CREATE_CUSTOMER');
    expect(draftResponse.message.actionDraft?.proposedChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Customer', to: 'David' }),
        expect.objectContaining({ label: 'Phone', to: '0414303343' }),
      ]),
    );
    expect(customers.create).not.toHaveBeenCalled();
  });

  it.each([
    ['0422462867', '0422462867'],
    ['0422 462 867', '0422462867'],
    ['+61422462867', '0422462867'],
    ['+61 422 462 867', '0422462867'],
    ['+61 422-462-867', '0422462867'],
  ])(
    'accepts Australian mobile format %s during customer contact collection',
    async (input, canonicalPhone) => {
      const { service: ai } = service();

      const response = await ai.chat(owner, {
        context: {
          pendingCustomer: { firstName: 'Ranjee' },
          pendingQuestion: {
            intent: 'CREATE_CUSTOMER',
            type: 'CUSTOMER_CONTACT',
          },
        },
        message: input,
      });

      expect(response.message.actionDraft?.type).toBe('CREATE_CUSTOMER');
      expect(
        response.message.actionDraft?.payload.type === 'CREATE_CUSTOMER'
          ? response.message.actionDraft.payload.customerPayload.phone
          : undefined,
      ).toBe(canonicalPhone);
      expect(response.message.actionDraft?.proposedChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Customer', to: 'Ranjee' }),
          expect.objectContaining({ label: 'Phone', to: canonicalPhone }),
        ]),
      );
    },
  );

  it('keeps customer name across mixed email contact collection', async () => {
    const { service: ai } = service();

    const nameResponse = await ai.chat(owner, {
      context: {
        pendingCustomer: {},
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER',
          type: 'CUSTOMER_NAME',
        },
      },
      message: 'David',
    });
    const draftResponse = await ai.chat(owner, {
      context: nameResponse.context,
      message: 'david@example.com',
    });

    expect(draftResponse.message.actionDraft?.proposedChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Customer', to: 'David' }),
        expect.objectContaining({ label: 'Email', to: 'david@example.com' }),
      ]),
    );
  });

  it('explains invalid contact input without losing collected customer name', async () => {
    const { service: ai } = service();

    const invalidResponse = await ai.chat(owner, {
      context: {
        pendingCustomer: { firstName: 'Ranjee' },
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER',
          type: 'CUSTOMER_CONTACT',
        },
      },
      message: 'Piza',
    });

    expect(invalidResponse.message.content).toContain("doesn't look like");
    expect(invalidResponse.message.actionDraft).toBeUndefined();
    expect(invalidResponse.context?.pendingCustomer?.firstName).toBe('Ranjee');

    const validResponse = await ai.chat(owner, {
      context: invalidResponse.context,
      message: '+61 422 462 867',
    });

    expect(validResponse.message.actionDraft?.type).toBe('CREATE_CUSTOMER');
    expect(validResponse.message.actionDraft?.proposedChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Customer', to: 'Ranjee' }),
        expect.objectContaining({ label: 'Phone', to: '0422462867' }),
      ]),
    );
  });

  it('keeps customer and contact slots across customer and job collection', async () => {
    const { jobs, service: ai } = service();

    const nameResponse = await ai.chat(owner, {
      context: {
        pendingCustomerAndJob: { customer: {}, job: {} },
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER_AND_JOB',
          type: 'CUSTOMER_NAME',
        },
      },
      message: 'Raj',
    });
    expect(nameResponse.message.content).toContain('phone number');

    const phoneResponse = await ai.chat(owner, {
      context: nameResponse.context,
      message: '043567890',
    });
    expect(phoneResponse.message.content).toContain('service address');
    expect(phoneResponse.message.content).not.toContain("customer's name");

    const draftResponse = await ai.chat(owner, {
      context: phoneResponse.context,
      message: '27 Coffey Street, Tarneit VIC 3029',
    });

    expect(draftResponse.message.actionDraft?.type).toBe(
      'CREATE_CUSTOMER_AND_JOB',
    );
    expect(draftResponse.message.actionDraft?.proposedChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Create customer', to: 'Raj' }),
        expect.objectContaining({ label: 'Phone', to: '043567890' }),
        expect.objectContaining({
          label: 'Service location',
          to: '27 Coffey Street, Tarneit, VIC, 3029',
        }),
      ]),
    );
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('deduplicates repeated duplicate customer warnings', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValueOnce([
      {
        displayName: 'Bhupathi',
        email: null,
        id: 'customer-duplicate',
        phone: '0414303343',
      },
      {
        displayName: 'Bhupathi',
        email: null,
        id: 'customer-duplicate',
        phone: '0414303343',
      },
    ]);
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: {
        pendingCustomer: { firstName: 'David' },
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER',
          type: 'CUSTOMER_CONTACT',
        },
      },
      message: '0414303343',
    });

    expect(response.message.actionDraft?.warnings).toEqual([
      'Possible duplicate: Bhupathi (0414303343).',
    ]);
  });

  it('detects duplicate customers across equivalent 04 and +61 phone formats', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValueOnce([
      {
        displayName: 'Existing Ranjee',
        email: null,
        id: 'customer-existing',
        phone: '0422462867',
      },
    ]);
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: {
        pendingCustomer: { firstName: 'Ranjee' },
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER',
          type: 'CUSTOMER_CONTACT',
        },
      },
      message: '+61 422 462 867',
    });

    const findManyCalls = prisma.customer.findMany.mock.calls as Array<
      [{ where: { OR?: Array<{ phoneNormalised?: string }> } }]
    >;
    expect(findManyCalls[0][0].where.OR).toEqual([
      expect.objectContaining({ phoneNormalised: '0422462867' }),
    ]);
    expect(response.message.actionDraft?.warnings).toEqual([
      'Possible duplicate: Existing Ranjee (0422462867).',
    ]);
  });

  it('recognises safe customer and job intent variants without broad fuzzy mutation', async () => {
    const { service: ai } = service();

    for (const message of [
      'Create customer & job',
      'Create a customer with a job',
      'Customer and job',
      'Creat customer and job',
      'Create customer and hob',
    ]) {
      const response = await ai.chat(owner, { message });
      expect(response.message.content).toContain("customer's name");
    }

    const unsupported = await ai.chat(owner, { message: 'Order me a pizza' });
    expect(unsupported.message.content).toContain("can't prepare");
  });

  it('rejects unrelated text during pending customer contact without losing context', async () => {
    const { service: ai } = service();

    const response = await ai.chat(owner, {
      context: {
        pendingCustomer: { firstName: 'David' },
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER',
          type: 'CUSTOMER_CONTACT',
        },
      },
      message: 'Order me a pizza',
    });

    expect(response.message.content).toContain("can't use that");
    expect(response.message.actionDraft).toBeUndefined();
    expect(response.context?.pendingCustomer?.firstName).toBe('David');
  });

  it('keeps customer and job name after invalid customer+job contact input', async () => {
    const { service: ai } = service();

    const invalidResponse = await ai.chat(owner, {
      context: {
        pendingCustomerAndJob: {
          customer: { firstName: 'Ranjee' },
          job: {},
        },
        pendingQuestion: {
          intent: 'CREATE_CUSTOMER_AND_JOB',
          type: 'CUSTOMER_CONTACT',
        },
      },
      message: 'Piza',
    });

    expect(invalidResponse.message.content).toContain("doesn't look like");
    expect(
      invalidResponse.context?.pendingCustomerAndJob?.customer.firstName,
    ).toBe('Ranjee');

    const validResponse = await ai.chat(owner, {
      context: invalidResponse.context,
      message: '+61 422 462 867',
    });

    expect(validResponse.message.content).toContain('service address');
    expect(validResponse.context?.pendingCustomerAndJob?.customer.phone).toBe(
      '0422462867',
    );
    expect(
      validResponse.context?.pendingCustomerAndJob?.customer.firstName,
    ).toBe('Ranjee');
  });

  it('blocks READ_ONLY users from confirming action drafts', async () => {
    const { service: ai } = service();
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'draft-1',
      payload: {
        appointmentId: 'appointment-1',
        expectedUpdatedAt: '2026-08-14T00:00:00.000Z',
        type: 'CANCEL_APPOINTMENT',
      },
      type: 'CANCEL_APPOINTMENT',
    } as ToriActionDraft;

    await expect(ai.confirm(readOnly, 'draft-1', draft)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects stale appointment action drafts before mutation', async () => {
    const prisma = createPrisma();
    prisma.appointment.findFirst.mockResolvedValueOnce({
      updatedAt: new Date('2026-08-14T01:00:00.000Z'),
    });
    const { appointments, service: ai } = service(prisma);
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'draft-1',
      payload: {
        appointmentId: 'appointment-1',
        appointmentPayload: {
          addressLine1: '1 Main Street',
          appointmentType: 'INSPECTION',
          jobId: 'job-1',
          postcode: '3000',
          scheduledEnd: '2026-08-15T06:00:00.000Z',
          scheduledStart: '2026-08-15T05:00:00.000Z',
          state: 'VIC',
          suburb: 'Melbourne',
        },
        expectedUpdatedAt: '2026-08-14T00:00:00.000Z',
        type: 'RESCHEDULE_APPOINTMENT',
      },
      type: 'RESCHEDULE_APPOINTMENT',
    } as ToriActionDraft;

    await expect(ai.confirm(owner, 'draft-1', draft)).rejects.toMatchObject({
      status: 409,
    });
    expect(appointments.update).not.toHaveBeenCalled();
  });
});
