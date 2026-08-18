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
  const customers = {
    create: jest.fn(),
    createSite: jest.fn(),
    listSites: jest.fn().mockResolvedValue([]),
  };
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

function roundTripContext<T>(context: T): T {
  return JSON.parse(JSON.stringify(context)) as T;
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
    expect(result.context).toMatchObject({
      customerId: 'customer-1',
      customerName: 'John Smith',
      recentCustomer: {
        displayName: 'John Smith',
        id: 'customer-1',
      },
    });
  });

  it('creates a job for the newly created customer across structured context without creating a duplicate customer', async () => {
    const prisma = createPrisma();
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
    prisma.customer.findFirst.mockResolvedValue(pooja);
    prisma.customer.findMany.mockResolvedValue([]);
    const { customers, jobs, service: ai } = service(prisma);
    customers.create.mockResolvedValue({ customer: pooja });
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '30 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Pooja', id: 'customer-pooja' },
        customerId: 'customer-pooja',
        id: 'job-pooja-1',
        jobNumber: 'JOB-2026-000101',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Blocked kitchen sink',
      },
    });

    const startCustomer = await ai.chat(owner, { message: 'Create customer' });
    expect(startCustomer.message.content).toContain("customer's name");

    const name = await ai.chat(owner, {
      context: roundTripContext(startCustomer.context),
      message: 'Pooja',
    });
    expect(name.message.content).toContain('phone number or email');

    const phone = await ai.chat(owner, {
      context: roundTripContext(name.context),
      message: '0450488583',
    });
    const customerDraft = phone.message.actionDraft;
    expect(customerDraft?.type).toBe('CREATE_CUSTOMER');
    expect(customers.create).not.toHaveBeenCalled();

    if (!customerDraft) throw new Error('Expected CREATE_CUSTOMER draft');
    const createdCustomer = await ai.confirm(
      owner,
      customerDraft.id,
      roundTripContext(customerDraft),
    );
    expect(createdCustomer.context).toMatchObject({
      customerId: 'customer-pooja',
      customerName: 'Pooja',
      recentCustomer: {
        displayName: 'Pooja',
        id: 'customer-pooja',
      },
    });

    const createJob = await ai.chat(owner, {
      context: roundTripContext(createdCustomer.context),
      message: 'Create job for the newly created customer',
    });
    expect(createJob.message.content).toContain('What is the job for');
    expect(createJob.message.content).not.toContain("customer's name");
    expect(createJob.message.actionDraft).toBeUndefined();
    expect(createJob.context?.pendingJob).toMatchObject({
      customerId: 'customer-pooja',
      customerName: 'Pooja',
    });

    const title = await ai.chat(owner, {
      context: roundTripContext(createJob.context),
      message: 'Blocked kitchen sink',
    });
    expect(title.message.content).toContain('service address');
    expect(title.context?.pendingJob?.title).toBe('Blocked kitchen sink');

    const address = await ai.chat(owner, {
      context: roundTripContext(title.context),
      message: '30 Coffey Street, Tarneit, 3029',
    });
    const jobDraft = address.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');
    expect(address.message.content).not.toContain('service address');
    expect(address.context?.pendingJob).toMatchObject({
      addressLine1: '30 Coffey Street',
      customerId: 'customer-pooja',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Blocked kitchen sink',
    });
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
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect(jobs.create).not.toHaveBeenCalled();

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const createdJob = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );

    expect(jobs.create).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        customerId: 'customer-pooja',
        title: 'Blocked kitchen sink',
      }),
    );
    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect(createdJob.context).toMatchObject({
      customerId: 'customer-pooja',
      customerName: 'Pooja',
      jobId: 'job-pooja-1',
      jobTitle: 'Blocked kitchen sink',
      recentJob: {
        id: 'job-pooja-1',
        title: 'Blocked kitchen sink',
      },
    });
  });

  it('orchestrates the exact Pooja dispatch request through safe drafts and confirmation resume', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.findFirst.mockResolvedValue({
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Pooja',
      email: null,
      firstName: 'Pooja',
      id: 'customer-pooja',
      lastName: null,
      phone: '0450488583',
      sites: [],
    });
    prisma.businessMember.findMany.mockResolvedValue([
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
    ]);
    const { appointments, customers, jobs, service: ai } = service(prisma);
    customers.create.mockResolvedValue({
      customer: {
        displayName: 'Pooja',
        email: null,
        id: 'customer-pooja',
        phone: '0450488583',
      },
    });
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '30 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Pooja', id: 'customer-pooja' },
        customerId: 'customer-pooja',
        id: 'job-pooja',
        jobNumber: 'JOB-2026-000111',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Blocked kitchen sink',
      },
    });
    appointments.create.mockResolvedValue({
      appointment: {
        appointmentNumber: 'APT-2026-000111',
        id: 'appointment-pooja',
        jobId: 'job-pooja',
        scheduledStart: new Date('2026-08-18T23:00:00.000Z'),
      },
    });

    const start = await ai.chat(owner, {
      message:
        'I have a new customer Pooja. Her number is 0450488583. Her kitchen sink is blocked at 30 Coffey Street, Tarneit. Book someone tomorrow morning.',
    });

    expect(start.message.content).not.toContain(
      "couldn't find appointments for tomorrow",
    );
    expect(start.message.content).toContain('How long should I allow');
    expect(start.context?.pendingDispatch).toMatchObject({
      customer: { name: 'Pooja', phone: '0450488583' },
      job: {
        addressLine1: '30 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Blocked kitchen sink',
      },
      scheduling: {
        daypart: 'MORNING',
      },
      stage: 'AWAITING_DURATION',
    });

    const duration = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: '60 minutes',
    });
    const customerDraft = duration.message.actionDraft;
    expect(customerDraft?.type).toBe('CREATE_CUSTOMER');
    expect(customers.create).not.toHaveBeenCalled();

    if (!customerDraft) throw new Error('Expected customer draft');
    const customerResult = await ai.confirm(
      owner,
      customerDraft.id,
      roundTripContext(customerDraft),
    );
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect(customerResult.nextMessage?.actionDraft?.type).toBe('CREATE_JOB');

    const jobDraft = customerResult.nextMessage?.actionDraft;
    if (!jobDraft) throw new Error('Expected job draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );
    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(jobResult.nextMessage?.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(jobResult.nextMessage?.content).toContain('Mia Nguyen is available');

    const appointmentDraft = jobResult.nextMessage?.actionDraft;
    if (!appointmentDraft) throw new Error('Expected appointment draft');
    expect(
      appointmentDraft.payload.type === 'CREATE_APPOINTMENT'
        ? appointmentDraft.payload.appointmentPayload
        : undefined,
    ).toMatchObject({
      addressLine1: '30 Coffey Street',
      assignedUserId: 'mia-1',
      jobId: 'job-pooja',
      locationSource: 'MANUAL',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
    });
    await ai.confirm(owner, appointmentDraft.id, appointmentDraft);
    expect(appointments.create).toHaveBeenCalledTimes(1);
  });

  it('parses Ranjan compound dispatch with current-turn entities before appointment search', async () => {
    const { service: ai } = service();

    const result = await ai.chat(owner, {
      message:
        'I have a new customer Ranjan. His number is 0450588583. Her master bed bath leak at 29 Coffey Street, Tarneit, 3029 VIC. Book someone for tomorrow',
    });

    expect(result.message.content).not.toContain(
      "couldn't find appointments for tomorrow",
    );
    expect(result.message.content).toContain('How long should I allow');
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: { name: 'Ranjan', phone: '0450588583' },
      job: {
        addressLine1: '29 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Master bedroom/bathroom leak',
      },
      stage: 'AWAITING_DURATION',
    });
    expect(typeof result.context?.pendingDispatch?.scheduling.date).toBe(
      'string',
    );
  });

  it('parses Ben dispatch with alternate wording and inferred Tarneit address details', async () => {
    const { service: ai } = service();

    const result = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. Her outdoor pergola tap leak at 27 Coffey Street Tarneit. Book someone for tomorrow',
    });

    expect(result.message.content).toContain('How long should I allow');
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: { name: 'Ben', phone: '0414303345' },
      job: {
        addressLine1: '27 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Outdoor pergola tap leak',
      },
    });
    expect(typeof result.context?.pendingDispatch?.scheduling.date).toBe(
      'string',
    );
  });

  it.each([
    'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning for 120 minutes.',
    'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Book someone for tomorrow morning for 120 minutes.',
    'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Schedule someone tomorrow morning for 120 minutes.',
    'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Send someone tomorrow morning for 120 minutes.',
  ])(
    'prioritises compound dispatch creation over tomorrow read lookup: %s',
    async (message) => {
      const { service: ai } = service();

      const result = await ai.chat(owner, { message });

      expect(result.message.content).not.toContain('Appointments tomorrow');
      expect(result.message.content).not.toContain('How long should I allow');
      expect(result.message.content).not.toContain('When should I book');
      expect(result.message.actionDraft?.type).toBe('CREATE_CUSTOMER');
      expect(result.context?.pendingDispatch).toMatchObject({
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
        stage: 'AWAITING_CUSTOMER_CONFIRMATION',
      });
      expect(result.context?.pendingDispatch?.scheduling.date).toBeTruthy();
      expect(
        result.context?.pendingDispatch?.scheduling.windowStart,
      ).toBeTruthy();
    },
  );

  it('lets existing Ben by equivalent phone skip duplicate customer creation in compound dispatch', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([
      {
        companyName: null,
        contactPreference: 'SMS',
        displayName: 'Ben',
        email: null,
        firstName: 'Ben',
        id: 'customer-ben',
        lastName: null,
        phone: '0414303345',
        sites: [],
      },
    ]);
    const { customers, service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning for 120 minutes.',
    });

    expect(result.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(customers.create).not.toHaveBeenCalled();
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: {
        customerId: 'customer-ben',
        name: 'Ben',
      },
      scheduling: {
        durationMinutes: 120,
      },
    });
  });

  it('continues dispatch after CREATE_JOB confirmation without standalone appointment prompt', async () => {
    const prisma = createPrisma();
    const ben = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ben',
      email: null,
      firstName: 'Ben',
      id: 'customer-ben',
      lastName: null,
      phone: '0414303345',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ben]);
    prisma.customer.findFirst.mockResolvedValue(ben);
    prisma.job.findMany.mockResolvedValue([]);
    const { appointments, customers, jobs, service: ai } = service(prisma);
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '27 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Ben', id: 'customer-ben' },
        customerId: 'customer-ben',
        id: 'job-ben',
        jobNumber: 'JOB-2026-000501',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap is leaking',
      },
    });

    const start = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes',
    });
    const jobDraft = start.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );

    expect(jobResult.message).not.toContain(
      'Would you like me to prepare an appointment?',
    );
    expect(jobResult.message).toContain("I'll check technician availability");
    expect(jobResult.nextMessage?.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(customers.create).not.toHaveBeenCalled();
    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it('runs new-customer dispatch through customer, job and appointment drafts without auto-confirming appointment', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.findFirst.mockResolvedValue({
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ben',
      email: null,
      firstName: 'Ben',
      id: 'customer-ben',
      lastName: null,
      phone: '0414303345',
      sites: [],
    });
    const { appointments, customers, jobs, service: ai } = service(prisma);
    customers.create.mockResolvedValue({
      customer: {
        displayName: 'Ben',
        email: null,
        id: 'customer-ben',
        phone: '0414303345',
      },
    });
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '27 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Ben', id: 'customer-ben' },
        customerId: 'customer-ben',
        id: 'job-ben',
        jobNumber: 'JOB-2026-000502',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap is leaking',
      },
    });

    const start = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes',
    });
    const customerDraft = start.message.actionDraft;
    expect(customerDraft?.type).toBe('CREATE_CUSTOMER');

    if (!customerDraft) throw new Error('Expected CREATE_CUSTOMER draft');
    const customerResult = await ai.confirm(
      owner,
      customerDraft.id,
      roundTripContext(customerDraft),
    );
    const jobDraft = customerResult.nextMessage?.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );

    expect(jobResult.nextMessage?.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it('preserves dispatch context after no availability and retries afternoon without duplicate customer or job', async () => {
    const prisma = createPrisma();
    const ben = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ben',
      email: null,
      firstName: 'Ben',
      id: 'customer-ben',
      lastName: null,
      phone: '0414303345',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ben]);
    prisma.customer.findFirst.mockResolvedValue(ben);
    prisma.job.findMany.mockResolvedValue([]);
    const { appointments, customers, jobs, service: ai } = service(prisma);
    appointments.availability.mockResolvedValue({
      canOverride: false,
      conflicts: [{ id: 'appointment-conflict' }],
      hasConflict: true,
      reason: 'Technician already has an overlapping appointment.',
    });
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '27 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Ben', id: 'customer-ben' },
        customerId: 'customer-ben',
        id: 'job-ben',
        jobNumber: 'JOB-2026-000503',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap is leaking',
      },
    });

    const start = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes',
    });
    const jobDraft = start.message.actionDraft;
    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );

    expect(jobResult.nextMessage?.content).toContain(
      'No technician can fit a 120-minute appointment',
    );
    expect(jobResult.context?.pendingDispatch).toMatchObject({
      customer: { customerId: 'customer-ben', name: 'Ben' },
      job: {
        jobId: 'job-ben',
        title: 'Pergola tap is leaking',
      },
      scheduling: {
        daypart: 'MORNING',
        durationMinutes: 120,
      },
      stage: 'NO_AVAILABILITY',
    });
    appointments.availability.mockReset();
    appointments.availability.mockResolvedValue({
      canOverride: false,
      conflicts: [],
      hasConflict: false,
      reason: 'No conflict',
    });

    const retry = await ai.chat(owner, {
      context: roundTripContext(jobResult.context),
      message: 'Afternoon',
    });

    expect(retry.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(retry.context?.pendingDispatch).toMatchObject({
      customer: { customerId: 'customer-ben', name: 'Ben' },
      job: { jobId: 'job-ben', title: 'Pergola tap is leaking' },
      scheduling: {
        daypart: 'AFTERNOON',
        durationMinutes: 120,
      },
    });
    expect(customers.create).not.toHaveBeenCalled();
    expect(jobs.create).toHaveBeenCalledTimes(1);
  });

  it('retries no-availability dispatch for any time tomorrow without duplicate records', async () => {
    const prisma = createPrisma();
    const ben = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ben',
      email: null,
      firstName: 'Ben',
      id: 'customer-ben',
      lastName: null,
      phone: '0414303345',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ben]);
    prisma.customer.findFirst.mockResolvedValue(ben);
    prisma.job.findMany.mockResolvedValue([]);
    const { appointments, jobs, service: ai } = service(prisma);
    appointments.availability.mockResolvedValue({
      canOverride: false,
      conflicts: [{ id: 'appointment-conflict' }],
      hasConflict: true,
      reason: 'Technician already has an overlapping appointment.',
    });
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '27 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Ben', id: 'customer-ben' },
        customerId: 'customer-ben',
        id: 'job-ben',
        jobNumber: 'JOB-2026-000504',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap is leaking',
      },
    });

    const start = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes',
    });
    const jobDraft = start.message.actionDraft;
    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );
    appointments.availability.mockReset();
    appointments.availability.mockResolvedValue({
      canOverride: false,
      conflicts: [],
      hasConflict: false,
      reason: 'No conflict',
    });

    const retry = await ai.chat(owner, {
      context: roundTripContext(jobResult.context),
      message: 'Any time tomorrow',
    });

    expect(retry.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(retry.context?.pendingDispatch?.scheduling.daypart).toBeUndefined();
    expect(jobs.create).toHaveBeenCalledTimes(1);
  });

  it('retries no-availability dispatch for another date while retaining customer, job and duration', async () => {
    const prisma = createPrisma();
    const ben = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ben',
      email: null,
      firstName: 'Ben',
      id: 'customer-ben',
      lastName: null,
      phone: '0414303345',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ben]);
    prisma.customer.findFirst.mockResolvedValue(ben);
    prisma.job.findMany.mockResolvedValue([]);
    const { appointments, jobs, service: ai } = service(prisma);
    appointments.availability.mockResolvedValue({
      canOverride: false,
      conflicts: [{ id: 'appointment-conflict' }],
      hasConflict: true,
      reason: 'Technician already has an overlapping appointment.',
    });
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '27 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Ben', id: 'customer-ben' },
        customerId: 'customer-ben',
        id: 'job-ben',
        jobNumber: 'JOB-2026-000505',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap is leaking',
      },
    });

    const start = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes',
    });
    const jobDraft = start.message.actionDraft;
    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );
    appointments.availability.mockReset();
    appointments.availability.mockResolvedValue({
      canOverride: false,
      conflicts: [],
      hasConflict: false,
      reason: 'No conflict',
    });

    const retry = await ai.chat(owner, {
      context: roundTripContext(jobResult.context),
      message: 'Try August 20',
    });

    expect(retry.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(retry.context?.pendingDispatch).toMatchObject({
      customer: { customerId: 'customer-ben' },
      job: { jobId: 'job-ben' },
      scheduling: { durationMinutes: 120 },
    });
    expect(retry.context?.pendingDispatch?.scheduling.date).toMatch(
      /^\d{4}-08-20$/,
    );
    expect(jobs.create).toHaveBeenCalledTimes(1);
  });

  it('keeps standalone CREATE_JOB appointment offer unchanged when no dispatch was requested', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([
      {
        companyName: null,
        contactPreference: 'SMS',
        displayName: 'Ben',
        email: null,
        firstName: 'Ben',
        id: 'customer-ben',
        lastName: null,
        phone: '0414303345',
        sites: [
          {
            accessInstructions: null,
            addressLine1: '27 Coffey Street',
            addressLine2: null,
            id: 'site-ben',
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
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '27 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Ben', id: 'customer-ben' },
        customerId: 'customer-ben',
        id: 'job-ben',
        jobNumber: 'JOB-2026-000506',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap leak',
      },
    });

    const start = await ai.chat(owner, {
      message: 'Create a job for Ben for pergola tap leak',
    });
    const jobDraft = start.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );

    expect(jobResult.message).toContain(
      'Would you like me to prepare an appointment?',
    );
    expect(jobResult.nextMessage).toBeUndefined();
  });

  it('lets explicit Ben compound dispatch override stale Ranjan context', async () => {
    const { service: ai } = service();

    const result = await ai.chat(owner, {
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
    });

    expect(result.message.content).not.toContain('Ranjan');
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: { name: 'Ben', phone: '0414303345' },
      job: { title: 'Pergola tap is leaking' },
      scheduling: {
        daypart: 'MORNING',
        durationMinutes: 120,
      },
    });
  });

  it('keeps create appointment wording actionable instead of tomorrow read lookup', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([
      {
        companyName: null,
        contactPreference: 'SMS',
        displayName: 'Ben',
        email: null,
        firstName: 'Ben',
        id: 'customer-ben',
        lastName: null,
        phone: '0414303345',
        sites: [],
      },
    ]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ben tomorrow morning for 120 minutes.',
    });

    expect(result.message.content).not.toContain('Appointments tomorrow');
    expect(result.context?.pendingDispatch?.customer.name).toBe('Ben');
    expect(result.context?.pendingDispatch?.scheduling.durationMinutes).toBe(
      120,
    );
  });

  it.each([
    'What appointments do I have tomorrow?',
    "Show tomorrow's appointments.",
    "What's happening tomorrow?",
  ])(
    'keeps genuine appointment read query as read only: %s',
    async (message) => {
      const { service: ai } = service();

      const result = await ai.chat(owner, { message });

      expect(result.message.content).toContain('Appointments tomorrow');
      expect(result.message.actionDraft).toBeUndefined();
      expect(result.context?.pendingDispatch).toBeUndefined();
    },
  );

  it('uses explicit current-turn customer and issue instead of stale recent appointment context', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([
      {
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
      },
    ]);
    prisma.job.findMany.mockResolvedValue([]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
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
    });

    expect(result.message.content).not.toContain('Ben');
    expect(result.message.content).not.toContain('What date');
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: {
        customerId: 'customer-ranjan',
        name: 'Ranjan',
      },
      job: {
        title: 'Front yard tap leak',
      },
    });
    expect(result.context?.pendingDispatch?.scheduling.date).toMatch(
      /^\d{4}-08-21$/,
    );
  });

  it('resolves an existing customer saved service address before asking for appointment address', async () => {
    const prisma = createPrisma();
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
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak for Aug 21 please.',
    });

    expect(result.message.content).not.toContain('full service address');
    expect(result.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(
      result.message.actionDraft?.payload.type === 'CREATE_JOB'
        ? result.message.actionDraft.payload.jobPayload
        : undefined,
    ).toMatchObject({
      addressLine1: '29 Coffey Street',
      customerId: 'customer-ranjan',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Front yard tap leak',
    });
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: { customerId: 'customer-ranjan', name: 'Ranjan' },
      job: {
        addressLine1: '29 Coffey Street',
        title: 'Front yard tap leak',
      },
    });
    expect(result.context?.pendingDispatch?.scheduling.date).toMatch(
      /^\d{4}-08-21$/,
    );
  });

  it('does not attach an appointment request to an unrelated existing job', async () => {
    const prisma = createPrisma();
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
    prisma.job.findMany.mockResolvedValue([
      {
        addressLine1: '29 Coffey Street',
        customerId: 'customer-ranjan',
        id: 'job-unrelated',
        jobNumber: 'JOB-2026-000201',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Master bedroom bathroom has a leak',
      },
    ]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak for Aug 21 please.',
    });

    expect(result.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(result.context?.pendingDispatch?.job.jobId).toBeUndefined();
    expect(result.context?.pendingDispatch?.job.title).toBe(
      'Front yard tap leak',
    );
  });

  it('reuses a matching open job for an existing customer appointment request', async () => {
    const prisma = createPrisma();
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
    prisma.job.findMany.mockResolvedValue([
      {
        addressLine1: '29 Coffey Street',
        customerId: 'customer-ranjan',
        id: 'job-front-yard',
        jobNumber: 'JOB-2026-000202',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Front yard tap leak',
      },
    ]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak for Aug 21 please.',
    });

    expect(result.message.actionDraft).toBeUndefined();
    expect(result.message.content).toContain('What time on');
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: { customerId: 'customer-ranjan' },
      job: { jobId: 'job-front-yard', title: 'Front yard tap leak' },
    });
  });

  it('asks for a service address when the resolved customer has no saved service address', async () => {
    const prisma = createPrisma();
    const ranjan = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjan',
      email: null,
      firstName: 'Ranjan',
      id: 'customer-ranjan',
      lastName: null,
      phone: '0450588583',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ranjan]);
    prisma.customer.findFirst.mockResolvedValue(ranjan);
    prisma.job.findMany.mockResolvedValue([]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak for Aug 21 please.',
    });

    expect(result.message.content).toContain('full service address');
    expect(result.message.actionDraft).toBeUndefined();
  });

  it('asks the user to choose when a customer has multiple non-primary service locations', async () => {
    const prisma = createPrisma();
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
          id: 'site-ranjan-1',
          isPrimary: false,
          label: 'Home',
          postcode: '3029',
          state: 'VIC',
          suburb: 'Tarneit',
        },
        {
          accessInstructions: null,
          addressLine1: '15 Example Street',
          addressLine2: null,
          id: 'site-ranjan-2',
          isPrimary: false,
          label: 'Rental',
          postcode: '3030',
          state: 'VIC',
          suburb: 'Werribee',
        },
      ],
    };
    prisma.customer.findMany.mockResolvedValue([ranjan]);
    prisma.customer.findFirst.mockResolvedValue(ranjan);
    prisma.job.findMany.mockResolvedValue([]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak for Aug 21 please.',
    });

    expect(result.message.content).toContain('multiple service locations');
    expect(result.message.content).toContain(
      '1. 29 Coffey Street, Tarneit, VIC, 3029',
    );
    expect(result.message.content).toContain(
      '2. 15 Example Street, Werribee, VIC, 3030',
    );
    expect(result.message.actionDraft).toBeUndefined();
  });

  it('uses an explicit current-turn address instead of the saved service address', async () => {
    const prisma = createPrisma();
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
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak at 50 Example Street, Tarneit VIC 3029 on Aug 21.',
    });

    expect(result.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(
      result.message.actionDraft?.payload.type === 'CREATE_JOB'
        ? result.message.actionDraft.payload.jobPayload
        : undefined,
    ).toMatchObject({
      addressLine1: '50 Example Street',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
    });
  });

  it('retains resolved customer, issue, date and address across time and duration collection', async () => {
    const prisma = createPrisma();
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
    const createdJob = {
      addressLine1: '29 Coffey Street',
      addressLine2: null,
      customer: { displayName: 'Ranjan', id: 'customer-ranjan' },
      customerId: 'customer-ranjan',
      id: 'job-ranjan-front-yard',
      jobNumber: 'JOB-2026-000203',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Front yard tap leak',
    };
    prisma.customer.findMany.mockResolvedValue([ranjan]);
    prisma.customer.findFirst.mockResolvedValue(ranjan);
    prisma.job.findMany.mockResolvedValue([]);
    const { jobs, service: ai } = service(prisma);
    jobs.create.mockResolvedValue({ job: createdJob });

    const start = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak for Aug 21 please.',
    });
    const jobDraft = start.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );
    expect(jobResult.nextMessage?.content).toContain('What time on');

    const time = await ai.chat(owner, {
      context: roundTripContext(jobResult.context),
      message: '9am',
    });
    expect(time.message.content).toContain('How long');
    expect(time.context?.pendingDispatch).toMatchObject({
      customer: { customerId: 'customer-ranjan', name: 'Ranjan' },
      job: {
        addressLine1: '29 Coffey Street',
        jobId: 'job-ranjan-front-yard',
        title: 'Front yard tap leak',
      },
      scheduling: { preferredStart: '09:00' },
    });
    expect(time.context?.pendingDispatch?.scheduling.date).toMatch(
      /^\d{4}-08-21$/,
    );

    const duration = await ai.chat(owner, {
      context: roundTripContext(time.context),
      message: '120 mins',
    });
    expect(duration.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
  });

  it.each([
    {
      expectedCustomer: 'Ben',
      expectedDuration: 120,
      expectedIssue: 'Pergola tap is leaking',
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes.',
      setup: 'new-ben',
      type: 'CREATE_CUSTOMER',
    },
    {
      expectedCustomer: 'Ben',
      expectedDuration: 120,
      expectedIssue: 'Pergola tap leaking',
      message:
        'New customer Ben 0414303345, pergola tap leaking, 27 Coffey Street Tarneit. Book someone tomorrow morning for 2 hours.',
      setup: 'new-ben',
      type: 'CREATE_CUSTOMER',
    },
    {
      expectedCustomer: 'Ben',
      expectedDuration: 120,
      expectedIssue: 'Pergola tap leak',
      message:
        'Can you send someone to Ben tomorrow morning for the pergola tap leak? 120 mins.',
      setup: 'existing-ben',
      type: 'CREATE_JOB',
    },
    {
      expectedCustomer: 'Ben',
      expectedIssue: 'Pergola tap leak',
      message: "Schedule Ben's pergola tap leak tomorrow morning.",
      setup: 'existing-ben',
      type: 'CREATE_JOB',
    },
    {
      expectedCustomer: 'Ranjan',
      expectedIssue: 'Front yard tap leak',
      message: 'Book Ranjan Aug 21 for the front yard tap leak.',
      setup: 'existing-ranjan',
      type: 'CREATE_JOB',
    },
    {
      expectedCustomer: 'Ranjan',
      expectedIssue: 'Front tap',
      message: 'Ranjan needs someone for his front tap on Aug 21.',
      setup: 'existing-ranjan',
      type: 'CREATE_JOB',
    },
    {
      expectedCustomer: 'Ranjan',
      expectedDuration: 120,
      expectedStart: '09:00',
      message: 'Create appointment for Ranjan Aug 21 at 9am for 2 hours.',
      setup: 'existing-ranjan',
      type: undefined,
    },
  ])(
    'normalises natural dispatch wording into one semantic workflow: $message',
    async ({
      expectedCustomer,
      expectedDuration,
      expectedIssue,
      expectedStart,
      message,
      setup,
      type,
    }) => {
      const prisma = createPrisma();
      const ben = {
        companyName: null,
        contactPreference: 'SMS',
        displayName: 'Ben',
        email: null,
        firstName: 'Ben',
        id: 'customer-ben',
        lastName: null,
        phone: '0414303345',
        sites: [
          {
            accessInstructions: null,
            addressLine1: '27 Coffey Street',
            addressLine2: null,
            id: 'site-ben',
            isPrimary: true,
            label: 'Home',
            postcode: '3029',
            state: 'VIC',
            suburb: 'Tarneit',
          },
        ],
      };
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
      if (setup === 'new-ben') {
        prisma.customer.findMany.mockResolvedValue([]);
        prisma.customer.findFirst.mockResolvedValue(ben);
      } else {
        prisma.customer.findMany.mockResolvedValue([
          setup === 'existing-ben' ? ben : ranjan,
        ]);
        prisma.customer.findFirst.mockResolvedValue(
          setup === 'existing-ben' ? ben : ranjan,
        );
      }
      prisma.job.findMany.mockResolvedValue([]);
      const { service: ai } = service(prisma);

      const result = await ai.chat(owner, { message });

      expect(result.message.content).not.toContain('Appointments tomorrow');
      expect(result.message.actionDraft?.type).toBe(type);
      expect(result.context?.pendingDispatch?.customer.name).toBe(
        expectedCustomer,
      );
      if (expectedIssue) {
        expect(result.context?.pendingDispatch?.job.title).toBe(expectedIssue);
      }
      if (expectedDuration) {
        expect(
          result.context?.pendingDispatch?.scheduling.durationMinutes,
        ).toBe(expectedDuration);
      }
      if (expectedStart) {
        expect(result.context?.pendingDispatch?.scheduling.preferredStart).toBe(
          expectedStart,
        );
      }
    },
  );

  it('proposes a single trusted historical job address for the same customer instead of asking for a full address', async () => {
    const prisma = createPrisma();
    const ranjan = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjan',
      email: null,
      firstName: 'Ranjan',
      id: 'customer-ranjan',
      lastName: null,
      phone: '0450588583',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ranjan]);
    prisma.customer.findFirst.mockResolvedValue(ranjan);
    prisma.job.findMany.mockResolvedValue([
      {
        addressLine1: '29 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Master bedroom bathroom has a leak',
      },
    ]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message: 'Create appointment for Ranjan for front yard tap leak Aug 21.',
    });

    expect(result.message.content).toContain(
      "from Ranjan's previous job. Use this address?",
    );
    expect(result.message.content).toContain('29 Coffey Street');
    expect(result.context?.pendingDispatch?.job.proposedAddress).toMatchObject({
      addressLine1: '29 Coffey Street',
      source: 'HISTORICAL_JOB',
    });

    const accepted = await ai.chat(owner, {
      context: roundTripContext(result.context),
      message: 'yes',
    });
    expect(accepted.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(accepted.context?.pendingDispatch?.job).toMatchObject({
      addressLine1: '29 Coffey Street',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Front yard tap leak',
    });
  });

  it('asks the user to choose when multiple historical job addresses exist for the same customer', async () => {
    const prisma = createPrisma();
    const ranjan = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjan',
      email: null,
      firstName: 'Ranjan',
      id: 'customer-ranjan',
      lastName: null,
      phone: '0450588583',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ranjan]);
    prisma.customer.findFirst.mockResolvedValue(ranjan);
    prisma.job.findMany.mockResolvedValue([
      {
        addressLine1: '29 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      },
      {
        addressLine1: '15 Example Street',
        postcode: '3030',
        state: 'VIC',
        suburb: 'Werribee',
      },
    ]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message: 'Create appointment for Ranjan for front yard tap leak Aug 21.',
    });

    expect(result.message.content).toContain('multiple previous job addresses');
    expect(result.message.content).toContain('29 Coffey Street');
    expect(result.message.content).toContain('15 Example Street');
    expect(result.message.actionDraft).toBeUndefined();
  });

  it('never leaks another customer historical address into explicit current-turn customer resolution', async () => {
    const prisma = createPrisma();
    const ranjan = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjan',
      email: null,
      firstName: 'Ranjan',
      id: 'customer-ranjan',
      lastName: null,
      phone: '0450588583',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ranjan]);
    prisma.customer.findFirst.mockResolvedValue(ranjan);
    prisma.job.findMany.mockResolvedValue([]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message: 'Create appointment for Ranjan for front yard tap leak Aug 21.',
    });

    expect(result.message.content).toContain('full service address');
    type JobFindManyInput = {
      where?: { businessId?: string; customerId?: string };
    };
    const jobFindManyCalls = prisma.job.findMany.mock.calls as Array<
      [JobFindManyInput]
    >;
    const historicalLookup = jobFindManyCalls.find(
      ([input]) =>
        input?.where?.businessId === 'business-1' &&
        input.where.customerId === 'customer-ranjan',
    );
    expect(historicalLookup).toBeDefined();
  });

  it('persists a dispatch job address as a customer service location after confirmed job creation without duplicating existing sites', async () => {
    const prisma = createPrisma();
    const ben = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ben',
      email: null,
      firstName: 'Ben',
      id: 'customer-ben',
      lastName: null,
      phone: '0414303345',
      sites: [],
    };
    prisma.customer.findMany.mockResolvedValue([ben]);
    prisma.customer.findFirst.mockResolvedValue(ben);
    prisma.job.findMany.mockResolvedValue([]);
    const { customers, jobs, service: ai } = service(prisma);
    jobs.create.mockResolvedValue({
      job: {
        addressLine1: '27 Coffey Street',
        addressLine2: null,
        customer: { displayName: 'Ben', id: 'customer-ben' },
        customerId: 'customer-ben',
        id: 'job-ben',
        jobNumber: 'JOB-2026-000601',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
        title: 'Pergola tap is leaking',
      },
    });

    const start = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes.',
    });
    const jobDraft = start.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');
    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');

    await ai.confirm(owner, jobDraft.id, roundTripContext(jobDraft));

    expect(customers.createSite).toHaveBeenCalledWith(owner, 'customer-ben', {
      addressLine1: '27 Coffey Street',
      isPrimary: true,
      label: 'Service address',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
    });

    customers.createSite.mockClear();
    customers.listSites.mockResolvedValueOnce([
      {
        addressLine1: '27 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      },
    ]);
    const secondStart = await ai.chat(owner, {
      message:
        'I have a new customer Ben. His number is 0414303345. His pergola tap is leaking at 27 Coffey Street, Tarneit. Booking someone for tomorrow morning 120 minutes.',
    });
    const secondDraft = secondStart.message.actionDraft;
    if (!secondDraft) throw new Error('Expected second CREATE_JOB draft');
    await ai.confirm(owner, secondDraft.id, roundTripContext(secondDraft));
    expect(customers.createSite).not.toHaveBeenCalled();
  });

  it('extracts customer, issue, date, time and duration in one appointment turn', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([
      {
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
      },
    ]);
    prisma.job.findMany.mockResolvedValue([]);
    const { service: ai } = service(prisma);

    const result = await ai.chat(owner, {
      message:
        'Create an appointment for Ranjan for front yard tap leak for Aug 21 at 9am for 120 mins',
    });

    expect(result.message.content).not.toContain('What date');
    expect(result.message.content).not.toContain('What start time');
    expect(result.message.content).not.toContain('How long');
    expect(result.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(result.context?.pendingDispatch).toMatchObject({
      customer: {
        customerId: 'customer-ranjan',
        name: 'Ranjan',
      },
      job: {
        title: 'Front yard tap leak',
      },
      scheduling: {
        durationMinutes: 120,
        preferredStart: '09:00',
      },
    });
    expect(result.context?.pendingDispatch?.scheduling.date).toMatch(
      /^\d{4}-08-21$/,
    );
  });

  it('keeps availability questions as read queries instead of dispatch creation', async () => {
    const { service: ai } = service();

    const result = await ai.chat(owner, {
      message: 'Who is available tomorrow?',
    });

    expect(result.context?.pendingDispatch).toBeUndefined();
    expect(result.message.actionDraft).toBeUndefined();
    expect(result.message.content).toContain('available');
  });

  it('reuses an existing customer in dispatch orchestration and skips CREATE_CUSTOMER', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValue([
      {
        companyName: null,
        contactPreference: 'SMS',
        displayName: 'Pooja',
        email: null,
        firstName: 'Pooja',
        id: 'customer-pooja',
        lastName: null,
        phone: '0450488583',
        sites: [],
      },
    ]);
    const { customers, service: ai } = service(prisma);

    const start = await ai.chat(owner, {
      message:
        'New customer Pooja, 0450488583, blocked kitchen sink at 30 Coffey Street, Tarneit. Send someone tomorrow morning.',
    });
    const duration = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: '60 minutes',
    });

    expect(duration.message.actionDraft?.type).toBe('CREATE_JOB');
    expect(customers.create).not.toHaveBeenCalled();
    expect(duration.context?.pendingDispatch?.customer.customerId).toBe(
      'customer-pooja',
    );
  });

  it('keeps pending dispatch active across read interruptions and supports cancellation', async () => {
    const { service: ai } = service();
    const start = await ai.chat(owner, {
      message:
        'I have a new customer Pooja. Her number is 0450488583. Her kitchen sink is blocked at 30 Coffey Street, Tarneit. Book someone tomorrow morning.',
    });

    const read = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: 'Who is working tomorrow?',
    });
    expect(read.context?.pendingDispatch?.customer.name).toBe('Pooja');

    const cancel = await ai.chat(owner, {
      context: roundTripContext(read.context),
      message: 'Cancel this',
    });
    expect(cancel.message.content).toContain('cancelled');
    expect(cancel.context?.pendingDispatch).toBeUndefined();
  });

  it.each([
    'Create job for this customer',
    'Create job for her',
    'Create a job for Pooja',
    'Create another job for this customer',
  ])(
    'starts CREATE_JOB for a recent customer reference: %s',
    async (message) => {
      const prisma = createPrisma();
      prisma.customer.findFirst.mockResolvedValue({
        companyName: null,
        contactPreference: 'SMS',
        displayName: 'Pooja',
        email: null,
        firstName: 'Pooja',
        id: 'customer-pooja',
        lastName: null,
        phone: '0450488583',
        sites: [],
      });
      prisma.customer.findMany.mockResolvedValue([
        {
          companyName: null,
          contactPreference: 'SMS',
          displayName: 'Pooja',
          email: null,
          firstName: 'Pooja',
          id: 'customer-pooja',
          lastName: null,
          phone: '0450488583',
          sites: [],
        },
      ]);
      const { service: ai } = service(prisma);

      const response = await ai.chat(owner, {
        context: {
          customerId: 'customer-pooja',
          customerName: 'Pooja',
          recentCustomer: {
            displayName: 'Pooja',
            id: 'customer-pooja',
            phone: '0450488583',
          },
        },
        message,
      });

      expect(response.message.content).toContain('What is the job for');
      expect(response.message.content).not.toContain("customer's name");
      expect(response.context?.pendingQuestion).toMatchObject({
        intent: 'CREATE_JOB',
        type: 'JOB_TITLE',
      });
      expect(response.context?.pendingJob).toMatchObject({
        customerId: 'customer-pooja',
        customerName: 'Pooja',
      });
    },
  );

  it.each([
    'Create job for this customer',
    'Create job for her',
    'Create job for the newly created customer',
  ])(
    'asks which customer when a recent reference is missing: %s',
    async (message) => {
      const { service: ai } = service();

      const response = await ai.chat(owner, { message });

      expect(response.message.content).toContain(
        'Which customer is this job for',
      );
      expect(response.message.actionDraft).toBeUndefined();
    },
  );

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

  it('starts a fresh appointment workflow by asking for the customer before date/time', async () => {
    const { service: ai } = service();

    const start = await ai.chat(owner, { message: 'Create an appointment' });

    expect(start.message.content).toContain('Which customer');
    expect(start.context).toMatchObject({
      pendingAppointment: {},
      pendingQuestion: {
        intent: 'CREATE_APPOINTMENT_FOR_JOB',
        type: 'APPOINTMENT_CUSTOMER',
      },
    });

    const dateTooEarly = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: 'Aug 20, 9:00AM',
    });

    expect(dateTooEarly.message.content).toContain('customer');
    expect(dateTooEarly.message.content).not.toContain("can't prepare");
    expect(dateTooEarly.context?.pendingQuestion?.type).toBe(
      'APPOINTMENT_CUSTOMER',
    );
  });

  it('collects fresh appointment customer, job, natural date/time and duration across serialized requests', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValueOnce([
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
    ]);
    prisma.job.findMany.mockResolvedValueOnce([
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
    ]);
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

    const start = await ai.chat(owner, { message: 'Create an appointment' });
    const customer = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: 'Ranjee',
    });

    expect(customer.message.content).toContain('What date and time');
    expect(customer.context?.pendingAppointment).toMatchObject({
      customerId: 'customer-1',
      customerName: 'Ranjee',
      jobId: 'job-1',
    });

    const dateTime = await ai.chat(owner, {
      context: roundTripContext(customer.context),
      message: 'Aug 20, 9:00AM',
    });

    expect(dateTime.message.content).toContain('How long');
    expect(dateTime.context?.pendingAppointment).toMatchObject({
      date: '2026-08-20',
      time: '09:00',
    });

    const draft = await ai.chat(owner, {
      context: roundTripContext(dateTime.context),
      message: '60 minutes',
    });

    expect(draft.message.actionDraft?.type).toBe('CREATE_APPOINTMENT');
    expect(
      draft.message.actionDraft?.payload.type === 'CREATE_APPOINTMENT'
        ? draft.message.actionDraft.payload.appointmentPayload.scheduledStart
        : undefined,
    ).toBe('2026-08-19T23:00:00.000Z');
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it('branches from appointment scheduling into job creation and resumes appointment after job confirmation', async () => {
    const prisma = createPrisma();
    const customerRecord = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjee',
      email: null,
      firstName: 'Ranjee',
      id: 'customer-1',
      lastName: null,
      phone: '0422462867',
      sites: [
        {
          accessInstructions: null,
          addressLine1: '27 Coffey Street',
          addressLine2: null,
          id: 'site-1',
          isPrimary: true,
          label: 'Home',
          postcode: '3029',
          state: 'VIC',
          suburb: 'Tarneit',
        },
      ],
    };
    const createdJob = {
      addressLine1: '27 Coffey Street',
      addressLine2: null,
      customer: { displayName: 'Ranjee', id: 'customer-1', sites: [] },
      customerId: 'customer-1',
      id: 'job-created',
      jobNumber: 'JOB-2026-000099',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix leaking kitchen tap',
    };
    prisma.customer.findMany.mockResolvedValueOnce([customerRecord]);
    prisma.customer.findFirst.mockResolvedValue(customerRecord);
    prisma.job.findMany.mockResolvedValueOnce([]);
    prisma.job.findFirst.mockResolvedValue(createdJob);
    const { appointments, jobs, service: ai } = service(prisma);
    jobs.create.mockResolvedValue({ job: createdJob });
    appointments.create.mockResolvedValue({
      appointment: {
        appointmentNumber: 'APT-2026-000099',
        id: 'appointment-created',
        jobId: 'job-created',
        scheduledStart: new Date('2026-08-19T23:00:00.000Z'),
      },
    });

    const start = await ai.chat(owner, { message: 'Create an appointment?' });
    const customer = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: 'Ranjee',
    });

    expect(customer.message.content).toContain(
      "there isn't an active job to schedule",
    );
    expect(customer.message.content).toContain('prepare a job for Ranjee');
    expect(customer.context?.pendingQuestion?.type).toBe('APPOINTMENT_JOB');

    const createJob = await ai.chat(owner, {
      context: roundTripContext(customer.context),
      message: 'Yeah, create a job',
    });

    expect(createJob.message.content).toContain('What is the job for');
    expect(createJob.context?.pendingQuestion).toMatchObject({
      intent: 'CREATE_JOB',
      type: 'JOB_TITLE',
    });
    expect(createJob.context?.pendingJob?.resumeAppointment?.customerId).toBe(
      'customer-1',
    );

    const jobDraftResponse = await ai.chat(owner, {
      context: roundTripContext(createJob.context),
      message: 'Fix leaking kitchen tap',
    });

    const jobDraft = jobDraftResponse.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');
    expect(
      jobDraft?.payload.type === 'CREATE_JOB'
        ? jobDraft.payload.resumeAppointment?.customerId
        : undefined,
    ).toBe('customer-1');
    expect(jobs.create).not.toHaveBeenCalled();
    expect(appointments.create).not.toHaveBeenCalled();

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );

    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(appointments.create).not.toHaveBeenCalled();
    expect(jobResult.message).toContain("Now let's finish the appointment");
    expect(jobResult.context?.pendingAppointment?.jobId).toBe('job-created');
    expect(jobResult.context?.pendingQuestion?.type).toBe('APPOINTMENT_DATE');

    const dateTime = await ai.chat(owner, {
      context: roundTripContext(jobResult.context),
      message: 'Aug 20, 9:00AM',
    });
    expect(dateTime.message.content).toContain('How long');

    const appointmentDraftResponse = await ai.chat(owner, {
      context: roundTripContext(dateTime.context),
      message: '60 minutes',
    });
    const appointmentDraft = appointmentDraftResponse.message.actionDraft;
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
    expect(appointments.create).not.toHaveBeenCalled();

    if (!appointmentDraft) {
      throw new Error('Expected CREATE_APPOINTMENT draft');
    }
    const appointmentResult = await ai.confirm(
      owner,
      appointmentDraft.id,
      roundTripContext(appointmentDraft),
    );

    expect(appointmentResult.entityId).toBe('appointment-created');
    expect(appointments.create).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        addressLine1: '27 Coffey Street',
        customerSiteId: null,
        locationSource: 'MANUAL',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      }),
    );
    expect(appointments.create).toHaveBeenCalledTimes(1);
    await expect(
      ai.confirm(owner, jobDraft.id, roundTripContext(jobDraft)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      ai.confirm(
        owner,
        appointmentDraft.id,
        roundTripContext(appointmentDraft),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(appointments.create).toHaveBeenCalledTimes(1);
  });

  it('collects nested appointment job title and typed address before drafting the child job', async () => {
    const prisma = createPrisma();
    const customerRecord = {
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
    prisma.customer.findMany.mockResolvedValueOnce([customerRecord]);
    prisma.customer.findFirst.mockResolvedValue(customerRecord);
    prisma.job.findMany.mockResolvedValueOnce([]);
    const { appointments, jobs, service: ai } = service(prisma);
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
      title: 'Fix outdoor pipe leak',
    };
    jobs.create.mockResolvedValue({ job: createdJob });
    prisma.job.findFirst.mockResolvedValue(createdJob);
    appointments.create.mockResolvedValue({
      appointment: {
        appointmentNumber: 'APT-2026-000029',
        id: 'appointment-created',
        jobId: 'job-created',
        scheduledStart: new Date('2026-08-19T23:00:00.000Z'),
      },
    });

    const start = await ai.chat(owner, { message: 'Create an appointment' });
    const noJob = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: 'Ranjee',
    });
    const createJob = await ai.chat(owner, {
      context: roundTripContext(noJob.context),
      message: 'Create a job',
    });

    expect(createJob.message.content).toContain('What is the job for');

    const title = await ai.chat(owner, {
      context: roundTripContext(createJob.context),
      message: 'Fix outdoor pipe leak',
    });

    expect(title.context?.pendingJob?.title).toBe('Fix outdoor pipe leak');
    expect(title.context?.pendingJob?.resumeAppointment?.customerId).toBe(
      'customer-1',
    );
    expect(title.message.content).toContain('service address');
    expect(title.message.actionDraft).toBeUndefined();

    const jobDraftResponse = await ai.chat(owner, {
      context: roundTripContext(title.context),
      message: '27 Coffey Street, Tarneit, 3029',
    });

    const jobDraft = jobDraftResponse.message.actionDraft;
    expect(jobDraft?.type).toBe('CREATE_JOB');
    expect(jobDraftResponse.message.content).not.toContain('service address');
    expect(jobDraftResponse.context?.pendingJob).toMatchObject({
      addressLine1: '27 Coffey Street',
      customerId: 'customer-1',
      customerName: 'Ranjee',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix outdoor pipe leak',
    });
    expect(
      jobDraft?.payload.type === 'CREATE_JOB'
        ? jobDraft.payload.jobPayload
        : undefined,
    ).toMatchObject({
      addressLine1: '27 Coffey Street',
      customerId: 'customer-1',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Fix outdoor pipe leak',
    });
    expect(jobs.create).not.toHaveBeenCalled();
    expect(appointments.create).not.toHaveBeenCalled();

    if (!jobDraft) throw new Error('Expected CREATE_JOB draft');
    const jobResult = await ai.confirm(
      owner,
      jobDraft.id,
      roundTripContext(jobDraft),
    );

    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(jobResult.context?.pendingAppointment).toMatchObject({
      jobId: 'job-created',
      serviceLocation: {
        addressLine1: '27 Coffey Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      },
    });

    const dateTime = await ai.chat(owner, {
      context: roundTripContext(jobResult.context),
      message: 'Aug 20, 9:00AM',
    });
    const appointmentDraftResponse = await ai.chat(owner, {
      context: roundTripContext(dateTime.context),
      message: '60 minutes',
    });
    const appointmentDraft = appointmentDraftResponse.message.actionDraft;

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
    await ai.confirm(
      owner,
      appointmentDraft.id,
      roundTripContext(appointmentDraft),
    );

    expect(appointments.create).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        addressLine1: '27 Coffey Street',
        customerSiteId: null,
        locationSource: 'MANUAL',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      }),
    );
    expect(appointments.create).toHaveBeenCalledTimes(1);
    await expect(
      ai.confirm(
        owner,
        appointmentDraft.id,
        roundTripContext(appointmentDraft),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(appointments.create).toHaveBeenCalledTimes(1);
  });

  it('starts appointment child job creation from explicit create-job wording while waiting for a job', async () => {
    const prisma = createPrisma();
    const customerRecord = {
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
    prisma.customer.findFirst.mockResolvedValue(customerRecord);
    const { service: ai } = service(prisma);

    for (const message of [
      'Can we create a job for Ranjee customer?',
      'Yes please',
    ]) {
      const response = await ai.chat(owner, {
        context: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
          pendingAppointment: {
            customerId: 'customer-1',
            customerName: 'Ranjee',
          },
          pendingQuestion: {
            intent: 'CREATE_APPOINTMENT_FOR_JOB',
            type: 'APPOINTMENT_JOB',
          },
        },
        message,
      });

      expect(response.message.content).not.toContain('Which active job');
      expect(response.context?.pendingQuestion?.intent).toBe('CREATE_JOB');
    }
  });

  it('preserves nested job and parent appointment context after invalid child job address input', async () => {
    const prisma = createPrisma();
    const customerRecord = {
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
    prisma.customer.findFirst.mockResolvedValue(customerRecord);
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: {
        customerId: 'customer-1',
        customerName: 'Ranjee',
        pendingAppointment: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
        },
        pendingJob: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
          resumeAppointment: {
            customerId: 'customer-1',
            customerName: 'Ranjee',
          },
          title: 'Fix outdoor pipe leak',
        },
        pendingQuestion: {
          intent: 'CREATE_JOB',
          type: 'JOB_ADDRESS',
        },
      },
      message: 'near the side gate',
    });

    expect(response.message.content).toContain(
      'That does not look like a service address',
    );
    expect(response.context?.pendingQuestion).toMatchObject({
      intent: 'CREATE_JOB',
      type: 'JOB_ADDRESS',
    });
    expect(response.context?.pendingJob).toMatchObject({
      customerId: 'customer-1',
      title: 'Fix outdoor pipe leak',
    });
    expect(response.context?.pendingJob?.resumeAppointment?.customerId).toBe(
      'customer-1',
    );
  });

  it('asks for a service address when a nested child job customer has multiple non-primary service sites', async () => {
    const prisma = createPrisma();
    const customerRecord = {
      companyName: null,
      contactPreference: 'SMS',
      displayName: 'Ranjee',
      email: null,
      firstName: 'Ranjee',
      id: 'customer-1',
      lastName: null,
      phone: '0422462867',
      sites: [
        {
          accessInstructions: null,
          addressLine1: '1 First Street',
          addressLine2: null,
          id: 'site-1',
          isPrimary: false,
          label: 'Home',
          postcode: '3029',
          state: 'VIC',
          suburb: 'Tarneit',
        },
        {
          accessInstructions: null,
          addressLine1: '2 Second Street',
          addressLine2: null,
          id: 'site-2',
          isPrimary: false,
          label: 'Rental',
          postcode: '3029',
          state: 'VIC',
          suburb: 'Tarneit',
        },
      ],
    };
    prisma.customer.findFirst.mockResolvedValue(customerRecord);
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: {
        customerId: 'customer-1',
        customerName: 'Ranjee',
        pendingAppointment: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
        },
        pendingJob: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
          resumeAppointment: {
            customerId: 'customer-1',
            customerName: 'Ranjee',
          },
        },
        pendingQuestion: {
          intent: 'CREATE_JOB',
          type: 'JOB_TITLE',
        },
      },
      message: 'Fix outdoor pipe leak',
    });

    expect(response.message.content).toContain('multiple service addresses');
    expect(response.context?.pendingQuestion).toMatchObject({
      intent: 'CREATE_JOB',
      type: 'JOB_ADDRESS',
    });
    expect(response.message.actionDraft).toBeUndefined();
  });

  it('cancels the no-active-job appointment branch without creating data', async () => {
    const { appointments, jobs, service: ai } = service();

    const response = await ai.chat(owner, {
      context: {
        customerId: 'customer-1',
        customerName: 'Ranjee',
        pendingAppointment: {
          customerId: 'customer-1',
          customerName: 'Ranjee',
        },
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'APPOINTMENT_JOB',
        },
      },
      message: 'No thanks',
    });

    expect(response.message.content).toContain('No job or appointment');
    expect(response.context?.pendingAppointment).toBeUndefined();
    expect(jobs.create).not.toHaveBeenCalled();
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it('asks for job disambiguation when a customer has multiple active jobs', async () => {
    const prisma = createPrisma();
    prisma.customer.findMany.mockResolvedValueOnce([
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
    ]);
    prisma.job.findMany.mockResolvedValueOnce([
      {
        addressLine1: '1 Main Street',
        customer: { displayName: 'Ranjee', sites: [] },
        customerId: 'customer-1',
        id: 'job-1',
        jobNumber: 'JOB-2026-000001',
        postcode: '3000',
        state: 'VIC',
        suburb: 'Melbourne',
        title: 'Kitchen tap',
      },
      {
        addressLine1: '2 Main Street',
        customer: { displayName: 'Ranjee', sites: [] },
        customerId: 'customer-1',
        id: 'job-2',
        jobNumber: 'JOB-2026-000002',
        postcode: '3000',
        state: 'VIC',
        suburb: 'Melbourne',
        title: 'Bathroom leak',
      },
    ]);
    const { service: ai } = service(prisma);

    const start = await ai.chat(owner, { message: 'Create an appointment' });
    const response = await ai.chat(owner, {
      context: roundTripContext(start.context),
      message: 'Ranjee',
    });

    expect(response.message.content).toContain('multiple active jobs');
    expect(response.message.content).toContain('JOB-2026-000001');
    expect(response.context?.pendingQuestion?.type).toBe('APPOINTMENT_JOB');
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
      message: 'Aug 20, 9:00AM',
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

  it('answers technician availability with active Technician role members only', async () => {
    const prisma = createPrisma();
    const members = [
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
      {
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        user: {
          email: 'raj@demo-tradieos.com',
          firstName: 'Raj',
          id: 'raj-1',
          lastName: 'Patel',
        },
        userId: 'raj-1',
      },
      {
        role: 'ADMIN',
        status: 'ACTIVE',
        user: {
          email: 'ava@demo-tradieos.com',
          firstName: 'Ava',
          id: 'ava-1',
          lastName: 'Admin',
        },
        userId: 'ava-1',
      },
    ];
    prisma.businessMember.findMany.mockImplementation((args?: unknown) => {
      const roleIn = (
        args as { where?: { role?: { in?: string[] } } } | undefined
      )?.where?.role?.in;
      return Promise.resolve(
        roleIn
          ? members.filter((member) => roleIn.includes(member.role))
          : members,
      );
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: { appointmentId: 'appointment-1' },
      message: 'Who is available for this appointment?',
    });

    expect(response.message.content).toContain('Available technicians');
    expect(response.message.content).toContain('Mia Nguyen');
    expect(response.message.content).toContain('Raj Patel');
    expect(response.message.content).not.toContain('Ava Admin');
    expect(response.message.actionDraft).toBeUndefined();
  });

  it('prepares a smart reassignment draft for the lowest-workload available technician without mutating', async () => {
    const prisma = createPrisma();
    prisma.businessMember.findMany.mockResolvedValue([
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
      {
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        user: {
          email: 'raj@demo-tradieos.com',
          firstName: 'Raj',
          id: 'raj-1',
          lastName: 'Patel',
        },
        userId: 'raj-1',
      },
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      {
        assignedUserId: 'mia-1',
        scheduledEnd: new Date('2026-08-15T02:00:00.000Z'),
        scheduledStart: new Date('2026-08-15T00:00:00.000Z'),
      },
    ]);
    const { appointments, service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: { appointmentId: 'appointment-1' },
      message: 'Assign the best technician',
    });

    expect(response.message.actionDraft?.type).toBe('REASSIGN_TECHNICIAN');
    expect(response.message.actionDraft?.payload).toMatchObject({
      reassignmentPayload: { assignedUserId: 'raj-1' },
      type: 'REASSIGN_TECHNICIAN',
    });
    expect(response.message.content).toContain('Raj Patel');
    expect(appointments.reassign).not.toHaveBeenCalled();
  });

  it('does not prepare a reassignment draft for an active admin mention', async () => {
    const prisma = createPrisma();
    const members = [
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
      {
        role: 'ADMIN',
        status: 'ACTIVE',
        user: {
          email: 'ava@demo-tradieos.com',
          firstName: 'Ava',
          id: 'ava-1',
          lastName: 'Admin',
        },
        userId: 'ava-1',
      },
    ];
    prisma.businessMember.findMany.mockImplementation((args?: unknown) => {
      const roleIn = (
        args as { where?: { role?: { in?: string[] } } } | undefined
      )?.where?.role?.in;
      return Promise.resolve(
        roleIn
          ? members.filter((member) => roleIn.includes(member.role))
          : members,
      );
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    const { service: ai } = service(prisma);

    const response = await ai.chat(owner, {
      context: { appointmentId: 'appointment-1' },
      message: 'Assign Ava Admin',
    });

    expect(response.message.content).toContain(
      'cannot be assigned as the field technician',
    );
    expect(response.message.actionDraft).toBeUndefined();
  });

  it('does not draft a named reassignment when the technician has a conflict and offers an available alternative', async () => {
    const prisma = createPrisma();
    prisma.businessMember.findMany.mockResolvedValue([
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
      {
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        user: {
          email: 'raj@demo-tradieos.com',
          firstName: 'Raj',
          id: 'raj-1',
          lastName: 'Patel',
        },
        userId: 'raj-1',
      },
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    const { appointments, service: ai } = service(prisma);
    appointments.availability.mockImplementation(
      (_user: AuthenticatedUser, input: { assignedUserId?: string | null }) =>
        Promise.resolve(
          input.assignedUserId === 'mia-1'
            ? {
                canOverride: true,
                conflicts: [{ appointmentNumber: 'APT-2026-000010' }],
                hasConflict: true,
                reason: 'Mia Nguyen already has an appointment at that time.',
              }
            : {
                canOverride: false,
                conflicts: [],
                hasConflict: false,
                reason: 'No conflict',
              },
        ),
    );

    const response = await ai.chat(owner, {
      context: { appointmentId: 'appointment-1' },
      message: 'Assign Mia to this appointment',
    });

    expect(response.message.content).toContain('Mia Nguyen is not available');
    expect(response.message.content).toContain('Raj Patel is available');
    expect(response.message.actionDraft).toBeUndefined();
  });

  it('confirms reassignment drafts through the appointment service exactly once', async () => {
    const prisma = createPrisma();
    const { appointments, service: ai } = service(prisma);
    appointments.reassign.mockResolvedValue({
      appointment: {
        appointmentNumber: 'APT-2026-000001',
        assignedUser: {
          firstName: 'Raj',
          id: 'raj-1',
          lastName: 'Patel',
        },
        assignedUserId: 'raj-1',
        id: 'appointment-1',
      },
    });
    const draft = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: 'reassign-draft-once',
      payload: {
        appointmentId: 'appointment-1',
        expectedUpdatedAt: '2026-08-14T00:00:00.000Z',
        reassignmentPayload: {
          assignedUserId: 'raj-1',
          reason: 'Raj Patel is available with no overlapping appointment.',
        },
        type: 'REASSIGN_TECHNICIAN',
      },
      type: 'REASSIGN_TECHNICIAN',
    } as ToriActionDraft;

    const result = await ai.confirm(owner, draft.id, draft);

    expect(result.status).toBe('COMPLETED');
    expect(result.entityId).toBe('appointment-1');
    expect(appointments.reassign).toHaveBeenCalledWith(
      owner,
      'appointment-1',
      expect.objectContaining({ assignedUserId: 'raj-1' }),
    );
    await expect(ai.confirm(owner, draft.id, draft)).rejects.toMatchObject({
      status: 409,
    });
    expect(appointments.reassign).toHaveBeenCalledTimes(1);
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
