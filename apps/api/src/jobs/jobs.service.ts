import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  Appointment,
  AuthenticatedUser,
  Job,
  JobDetailResponse,
  JobListResponse,
  JobPriority,
  JobStatus,
} from '@tradieos/shared';
import {
  JOB_ARCHIVE_ROLES,
  JOB_STATUS_UPDATE_ROLES,
  JOB_VIEW_ROLES,
  JOB_WRITE_ROLES,
  getBusinessDateParts,
  getBusinessDayRangeUtc,
  getInvoiceDisplayStatus,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListJobsQueryDto,
  UpdateJobStatusDto,
  UpsertJobDto,
} from './dto/jobs.dto';

const DEFAULT_PAGE_SIZE = 20;
const READ_ONLY_JOB_ROLES = ['ACCOUNTANT', 'READ_ONLY', 'SALES'] as const;
const TECHNICIAN_ROLE = 'TECHNICIAN';
const COMPLETED_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

type JobWithRelations = {
  id: string;
  businessId: string;
  customerId: string;
  assignedToUserId: string | null;
  jobNumber: string;
  title: string;
  description: string | null;
  tradeType: string | null;
  status: JobStatus;
  priority: JobPriority;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  estimatedDurationMinutes: number | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  completedAt: Date | null;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  accessInstructions: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  requiresQuote: boolean;
  requiresInvoice: boolean;
  invoiceCreated: boolean;
  quoteCreated: boolean;
  sourceQuoteId: string | null;
  isArchived: boolean;
  archivedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
  };
  assignedTo: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
};

type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: ReturnType<JobsService['appointmentInclude']>;
}>;

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListJobsQueryDto,
  ): Promise<JobListResponse> {
    this.assertCanView(currentUser);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      100,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const business = await this.prisma.business.findUnique({
      where: { id: currentUser.businessId },
      select: { timezone: true },
    });
    const where = this.buildWhere(currentUser, query, business?.timezone);

    const [records, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        orderBy: this.orderBy(query.sortBy, query.sortOrder),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.jobInclude(),
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      records: records.map((job) => this.toJob(job)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  today(currentUser: AuthenticatedUser) {
    return this.findAll(currentUser, {
      filter: 'today',
      page: 1,
      pageSize: 50,
      sortBy: 'scheduledStart',
      sortOrder: 'asc',
    });
  }

  upcoming(currentUser: AuthenticatedUser) {
    return this.findAll(currentUser, {
      filter: 'upcoming',
      page: 1,
      pageSize: 50,
      sortBy: 'scheduledStart',
      sortOrder: 'asc',
    });
  }

  assigned(currentUser: AuthenticatedUser) {
    return this.findAll(currentUser, {
      assignedToUserId: currentUser.id,
      page: 1,
      pageSize: 50,
      sortBy: 'scheduledStart',
      sortOrder: 'asc',
    });
  }

  async findOne(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<JobDetailResponse> {
    this.assertCanView(currentUser);
    const job = await this.getJobForUser(currentUser, id);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId: currentUser.businessId,
        jobId: job.id,
      },
      include: this.appointmentInclude(),
      orderBy: { scheduledStart: 'asc' },
    });
    const [sourceQuote, relatedQuotes, invoices] = await Promise.all([
      job.sourceQuoteId
        ? this.prisma.quote.findFirst({
            where: {
              businessId: currentUser.businessId,
              id: job.sourceQuoteId,
            },
            select: {
              id: true,
              quoteNumber: true,
              status: true,
              title: true,
              totalCents: true,
            },
          })
        : Promise.resolve(null),
      this.prisma.quote.findMany({
        where: {
          businessId: currentUser.businessId,
          relatedJobId: job.id,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          title: true,
          totalCents: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          businessId: currentUser.businessId,
          jobId: job.id,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          amountPaidCents: true,
          balanceDueCents: true,
          dueDate: true,
          id: true,
          invoiceNumber: true,
          status: true,
          title: true,
          totalCents: true,
        },
      }),
    ]);
    const appointmentIds = appointments.map((appointment) => appointment.id);
    const [activity, appointmentActivity] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          businessId: currentUser.businessId,
          entityType: 'Job',
          entityId: job.id,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      appointmentIds.length
        ? this.prisma.auditLog.findMany({
            where: {
              businessId: currentUser.businessId,
              entityType: 'Appointment',
              entityId: { in: appointmentIds },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
    ]);
    const timeline = [...activity, ...appointmentActivity].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    return {
      activity: activity.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      })),
      appointments: appointments.map((appointment) =>
        this.toAppointment(appointment),
      ),
      invoices: invoices.map((invoice) => ({
        amountPaidCents: invoice.amountPaidCents,
        balanceDueCents: invoice.balanceDueCents,
        displayStatus: getInvoiceDisplayStatus({
          balanceDueCents: invoice.balanceDueCents,
          dueDate: invoice.dueDate.toISOString(),
          status: invoice.status,
        }),
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        title: invoice.title,
        totalCents: invoice.totalCents,
      })),
      job: this.toJob(job),
      relatedQuotes,
      sourceQuote,
      timeline: timeline.map((entry) => ({
        action: entry.action,
        createdAt: entry.createdAt.toISOString(),
        entityId: entry.entityId,
        entityType: entry.entityType,
        id: entry.id,
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      })),
    };
  }

  async create(
    currentUser: AuthenticatedUser,
    dto: UpsertJobDto,
  ): Promise<JobDetailResponse> {
    this.assertRole(currentUser, JOB_WRITE_ROLES);
    await this.assertAssignedUser(currentUser.businessId, dto.assignedToUserId);
    if (!dto.customerId && !dto.quickCustomer) {
      throw this.domainError(
        'INVALID_JOB_DATA',
        'Select an existing customer or create a quick customer.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.customerId) {
      await this.assertCustomer(currentUser.businessId, dto.customerId);
    }

    const job = await this.prisma.$transaction(async (tx) => {
      const customerId =
        dto.customerId ??
        (await this.createQuickCustomer(tx, currentUser, dto.quickCustomer!));
      const data = this.normalise(dto, customerId);
      const jobNumber = await this.nextJobNumber(
        tx as PrismaService,
        currentUser.businessId,
        data.scheduledStart,
      );
      const created = await tx.job.create({
        data: {
          ...data,
          businessId: currentUser.businessId,
          createdBy: currentUser.id,
          jobNumber,
        },
        include: this.jobInclude(),
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'JOB_CREATED',
          entityType: 'Job',
          entityId: created.id,
          metadata: {
            assignedToUserId: created.assignedToUserId,
            customerId: created.customerId,
            jobNumber: created.jobNumber,
          },
        },
      });

      if (created.assignedToUserId) {
        await tx.auditLog.create({
          data: {
            businessId: currentUser.businessId,
            actorUserId: currentUser.id,
            action: 'JOB_ASSIGNED',
            entityType: 'Job',
            entityId: created.id,
            metadata: { assignedToUserId: created.assignedToUserId },
          },
        });
      }

      return created;
    });

    return this.findOne(currentUser, job.id);
  }

  async update(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpsertJobDto,
  ): Promise<JobDetailResponse> {
    this.assertRole(currentUser, JOB_WRITE_ROLES);
    if (!dto.customerId) {
      throw this.domainError(
        'INVALID_JOB_DATA',
        'Job updates must reference an existing customer.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.getJob(currentUser.businessId, id);
    await this.assertCustomer(currentUser.businessId, dto.customerId);
    await this.assertAssignedUser(currentUser.businessId, dto.assignedToUserId);
    const data = this.normalise(dto, dto.customerId);

    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id },
        data: { ...data, updatedBy: currentUser.id },
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'JOB_UPDATED',
          entityType: 'Job',
          entityId: id,
          metadata: {
            changedFields: this.changedFields(existing, data),
          },
        },
      });

      if (existing.assignedToUserId !== data.assignedToUserId) {
        await tx.auditLog.create({
          data: {
            businessId: currentUser.businessId,
            actorUserId: currentUser.id,
            action: 'JOB_ASSIGNED',
            entityType: 'Job',
            entityId: id,
            metadata: {
              assignedToUserId: data.assignedToUserId,
              previousAssignedToUserId: existing.assignedToUserId,
            },
          },
        });
      }
    });

    return this.findOne(currentUser, id);
  }

  async updateStatus(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpdateJobStatusDto,
  ): Promise<JobDetailResponse> {
    this.assertRole(currentUser, JOB_STATUS_UPDATE_ROLES);
    const job = await this.getJobForUser(currentUser, id);
    const now = new Date();
    const statusData: Record<string, unknown> = {
      status: dto.status,
      updatedBy: currentUser.id,
    };

    if (dto.internalNotes) {
      statusData.internalNotes = dto.internalNotes.trim();
    }
    if (dto.status === 'IN_PROGRESS' && !job.actualStart) {
      statusData.actualStart = now;
    }
    if (dto.status === 'COMPLETED') {
      statusData.actualEnd = now;
      statusData.completedAt = now;
    }
    if (dto.status === 'CANCELLED') {
      statusData.actualEnd = job.actualEnd ?? now;
    }

    const action = this.auditActionForStatus(dto.status);
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id }, data: statusData });
      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action,
          entityType: 'Job',
          entityId: id,
          metadata: { from: job.status, to: dto.status },
        },
      });
    });

    return this.findOne(currentUser, id);
  }

  async archive(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<JobDetailResponse> {
    this.assertRole(currentUser, JOB_ARCHIVE_ROLES);
    await this.getJob(currentUser.businessId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          isArchived: true,
          updatedBy: currentUser.id,
        },
      });
      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'JOB_ARCHIVED',
          entityType: 'Job',
          entityId: id,
        },
      });
    });

    return this.findOne(currentUser, id);
  }

  async restore(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<JobDetailResponse> {
    this.assertRole(currentUser, JOB_ARCHIVE_ROLES);
    await this.getJob(currentUser.businessId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id },
        data: {
          archivedAt: null,
          isArchived: false,
          updatedBy: currentUser.id,
        },
      });
      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'JOB_RESTORED',
          entityType: 'Job',
          entityId: id,
        },
      });
    });

    return this.findOne(currentUser, id);
  }

  private buildWhere(
    currentUser: AuthenticatedUser,
    query: ListJobsQueryDto,
    timezone?: string,
  ): Prisma.JobWhereInput {
    const where: Prisma.JobWhereInput = {
      businessId: currentUser.businessId,
      isArchived: query.archived === 'true',
    };

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.customerId) where.customerId = query.customerId;
    if (query.assignedToUserId && currentUser.role !== TECHNICIAN_ROLE) {
      where.assignedToUserId = query.assignedToUserId;
    }
    if (query.filter) {
      this.applyFilter(where, query.filter, currentUser, timezone);
    }
    if (query.dateFrom || query.dateTo) {
      where.scheduledStart = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { jobNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { suburb: { contains: search, mode: 'insensitive' } },
        { postcode: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            displayName: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }
    if (currentUser.role === TECHNICIAN_ROLE) {
      where.assignedToUserId = currentUser.id;
    }

    return where;
  }

  private applyFilter(
    where: Prisma.JobWhereInput,
    filter: NonNullable<ListJobsQueryDto['filter']>,
    currentUser: AuthenticatedUser,
    timezone?: string,
  ) {
    const today = getBusinessDayRangeUtc(new Date(), timezone);
    const tomorrow = getBusinessDayRangeUtc(today.end, timezone);
    const dayAfterTomorrow = getBusinessDayRangeUtc(tomorrow.end, timezone);

    if (filter === 'today') {
      where.scheduledStart = { gte: today.start, lt: today.end };
    }
    if (filter === 'tomorrow') {
      where.scheduledStart = {
        gte: tomorrow.start,
        lt: dayAfterTomorrow.start,
      };
    }
    if (filter === 'upcoming') {
      where.scheduledStart = { gte: tomorrow.start };
      where.status = { notIn: [...COMPLETED_STATUSES] };
    }
    if (filter === 'completed') where.status = 'COMPLETED';
    if (filter === 'cancelled') where.status = 'CANCELLED';
    if (filter === 'high-priority') where.priority = { in: ['HIGH', 'URGENT'] };
    if (filter === 'my-jobs') where.assignedToUserId = currentUser.id;
    if (filter === 'unassigned') where.assignedToUserId = null;
  }

  private orderBy(
    sortBy: ListJobsQueryDto['sortBy'] = 'scheduledStart',
    sortOrder: ListJobsQueryDto['sortOrder'] = 'asc',
  ): Prisma.JobOrderByWithRelationInput[] {
    return [{ [sortBy]: sortOrder }, { createdAt: 'desc' }];
  }

  private normalise(dto: UpsertJobDto, customerId: string) {
    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = dto.scheduledEnd ? new Date(dto.scheduledEnd) : null;
    if (scheduledEnd && scheduledEnd <= scheduledStart) {
      throw this.domainError(
        'INVALID_JOB_DATA',
        'Scheduled end must be after scheduled start.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      customerId,
      assignedToUserId: dto.assignedToUserId || null,
      title: dto.title.trim(),
      description: this.clean(dto.description),
      tradeType: this.clean(dto.tradeType),
      status: dto.status,
      priority: dto.priority,
      scheduledStart,
      scheduledEnd,
      estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
      addressLine1: dto.addressLine1.trim(),
      addressLine2: this.clean(dto.addressLine2),
      suburb: dto.suburb.trim(),
      state: dto.state,
      postcode: dto.postcode.trim(),
      accessInstructions: this.clean(dto.accessInstructions),
      customerNotes: this.clean(dto.customerNotes),
      internalNotes: this.clean(dto.internalNotes),
      requiresQuote: Boolean(dto.requiresQuote),
      requiresInvoice: Boolean(dto.requiresInvoice),
    };
  }

  private async nextJobNumber(
    tx: PrismaService,
    businessId: string,
    scheduledStart: Date,
  ) {
    const [business, existing] = await Promise.all([
      tx.business.findUnique({
        where: { id: businessId },
        select: { timezone: true },
      }),
      tx.jobSequence.findUnique({ where: { businessId } }),
    ]);
    const year = getBusinessDateParts(scheduledStart, business?.timezone).year;
    const prefix = `JOB-${year}-`;
    const latestJob = await tx.job.findFirst({
      where: {
        businessId,
        jobNumber: { startsWith: prefix },
      },
      orderBy: { jobNumber: 'desc' },
      select: { jobNumber: true },
    });
    const latestNumber = this.sequenceNumberFromSuffix(
      latestJob?.jobNumber,
      prefix,
    );
    const nextNumber = Math.max(existing?.nextNumber ?? 1, latestNumber + 1);
    const nextSequenceNumber = nextNumber + 1;
    if (existing) {
      await tx.jobSequence.update({
        where: { businessId },
        data: { nextNumber: nextSequenceNumber },
      });
    } else {
      await tx.jobSequence.create({
        data: { businessId, nextNumber: nextSequenceNumber },
      });
    }
    return `JOB-${year}-${String(nextNumber).padStart(6, '0')}`;
  }

  private sequenceNumberFromSuffix(
    value: string | null | undefined,
    prefix: string,
  ) {
    if (!value?.startsWith(prefix)) {
      return 0;
    }
    const suffix = Number(value.slice(prefix.length));
    return Number.isInteger(suffix) && suffix > 0 ? suffix : 0;
  }

  private async getJobForUser(currentUser: AuthenticatedUser, id: string) {
    const job = await this.getJob(currentUser.businessId, id);
    if (
      currentUser.role === TECHNICIAN_ROLE &&
      job.assignedToUserId !== currentUser.id
    ) {
      throw this.domainError(
        'JOB_NOT_FOUND',
        'Job not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return job;
  }

  private async getJob(businessId: string, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { businessId, id },
      include: this.jobInclude(),
    });
    if (!job) {
      throw this.domainError(
        'JOB_NOT_FOUND',
        'Job not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return job;
  }

  private async assertCustomer(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { businessId, id: customerId, isArchived: false },
      select: { id: true },
    });
    if (!customer) {
      throw this.domainError(
        'CUSTOMER_NOT_FOUND',
        'Customer not found.',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async createQuickCustomer(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    quickCustomer: NonNullable<UpsertJobDto['quickCustomer']>,
  ) {
    const email = this.clean(quickCustomer.email)?.toLowerCase() ?? null;
    const customer = await tx.customer.create({
      data: {
        addressLine1: quickCustomer.addressLine1.trim(),
        addressLine2: this.clean(quickCustomer.addressLine2),
        businessId: currentUser.businessId,
        contactPreference: 'PHONE',
        createdBy: currentUser.id,
        customerType: 'RESIDENTIAL',
        displayName: quickCustomer.name.trim(),
        email,
        emailNormalised: email,
        firstName: quickCustomer.name.trim(),
        phone: quickCustomer.phone.trim(),
        phoneNormalised: quickCustomer.phone.replace(/\D/g, ''),
        postcode: quickCustomer.postcode.trim(),
        state: quickCustomer.state,
        suburb: quickCustomer.suburb.trim(),
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        action: 'CUSTOMER_QUICK_CREATED',
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: customer.id,
        entityType: 'Customer',
        metadata: { source: 'JOB_QUICK_FLOW' },
      },
    });
    return customer.id;
  }

  private async assertAssignedUser(
    businessId: string,
    assignedToUserId?: string | null,
  ) {
    if (!assignedToUserId) return;
    const user = await this.prisma.user.findFirst({
      where: { businessId, id: assignedToUserId, isActive: true },
      select: { id: true },
    });
    if (!user) {
      throw this.domainError(
        'ASSIGNEE_NOT_FOUND',
        'Assigned team member not found.',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private assertCanView(currentUser: AuthenticatedUser) {
    this.assertRole(currentUser, JOB_VIEW_ROLES);
  }

  private assertRole(
    currentUser: AuthenticatedUser,
    allowedRoles: readonly string[],
  ) {
    if (!allowedRoles.includes(currentUser.role)) {
      throw this.domainError(
        'INSUFFICIENT_PERMISSION',
        'You do not have permission to manage jobs.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      READ_ONLY_JOB_ROLES.includes(currentUser.role as never) &&
      allowedRoles !== JOB_VIEW_ROLES
    ) {
      throw this.domainError(
        'INSUFFICIENT_PERMISSION',
        'This role can only view jobs.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private changedFields(
    existing: JobWithRelations,
    data: Record<string, unknown>,
  ) {
    return Object.entries(data)
      .filter(
        ([key, value]) =>
          JSON.stringify(existing[key as keyof JobWithRelations]) !==
          JSON.stringify(value),
      )
      .map(([key]) => key);
  }

  private auditActionForStatus(status: JobStatus) {
    if (status === 'IN_PROGRESS') return 'JOB_STARTED';
    if (status === 'COMPLETED') return 'JOB_COMPLETED';
    if (status === 'CANCELLED') return 'JOB_CANCELLED';
    if (status === 'ON_HOLD') return 'JOB_ON_HOLD';
    return 'JOB_UPDATED';
  }

  private jobInclude() {
    return {
      assignedTo: {
        select: { email: true, firstName: true, id: true, lastName: true },
      },
      customer: {
        select: {
          companyName: true,
          displayName: true,
          email: true,
          id: true,
          phone: true,
        },
      },
    } satisfies Prisma.JobInclude;
  }

  private appointmentInclude() {
    return {
      assignedUser: {
        select: { email: true, firstName: true, id: true, lastName: true },
      },
      job: {
        select: {
          addressLine1: true,
          addressLine2: true,
          customer: {
            select: {
              companyName: true,
              displayName: true,
              email: true,
              id: true,
              phone: true,
            },
          },
          id: true,
          jobNumber: true,
          postcode: true,
          priority: true,
          state: true,
          suburb: true,
          title: true,
        },
      },
    } satisfies Prisma.AppointmentInclude;
  }

  private toJob(job: JobWithRelations): Job {
    return {
      id: job.id,
      businessId: job.businessId,
      customerId: job.customerId,
      assignedToUserId: job.assignedToUserId,
      jobNumber: job.jobNumber,
      title: job.title,
      description: job.description,
      tradeType: job.tradeType,
      status: job.status,
      priority: job.priority,
      scheduledStart: job.scheduledStart.toISOString(),
      scheduledEnd: job.scheduledEnd?.toISOString() ?? null,
      estimatedDurationMinutes: job.estimatedDurationMinutes,
      actualStart: job.actualStart?.toISOString() ?? null,
      actualEnd: job.actualEnd?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      addressLine1: job.addressLine1,
      addressLine2: job.addressLine2,
      suburb: job.suburb,
      state: job.state as Job['state'],
      postcode: job.postcode,
      accessInstructions: job.accessInstructions,
      customerNotes: job.customerNotes,
      internalNotes: job.internalNotes,
      requiresQuote: job.requiresQuote,
      requiresInvoice: job.requiresInvoice,
      invoiceCreated: job.invoiceCreated,
      quoteCreated: job.quoteCreated,
      sourceQuoteId: job.sourceQuoteId,
      isArchived: job.isArchived,
      archivedAt: job.archivedAt?.toISOString() ?? null,
      createdBy: job.createdBy,
      updatedBy: job.updatedBy,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      customer: job.customer,
      assignedTo: job.assignedTo,
    };
  }

  private toAppointment(appointment: AppointmentWithRelations): Appointment {
    const executionDurations = this.appointmentExecutionDurations(appointment);
    return {
      actualEnd: appointment.actualEnd?.toISOString() ?? null,
      actualStart: appointment.actualStart?.toISOString() ?? null,
      accessInstructions: appointment.accessInstructions,
      arrivedAt: appointment.arrivedAt?.toISOString() ?? null,
      addressLine1: appointment.addressLine1,
      addressLine2: appointment.addressLine2,
      appointmentNumber: appointment.appointmentNumber,
      appointmentType: appointment.appointmentType,
      assignedUser: appointment.assignedUser,
      assignedUserId: appointment.assignedUserId,
      businessId: appointment.businessId,
      completedAt: appointment.completedAt?.toISOString() ?? null,
      createdAt: appointment.createdAt.toISOString(),
      createdBy: appointment.createdBy,
      currentWorkStartedAt:
        appointment.currentWorkStartedAt?.toISOString() ?? null,
      customerSiteId: appointment.customerSiteId,
      estimatedDurationMinutes: appointment.estimatedDurationMinutes,
      executionDurations,
      id: appointment.id,
      job: {
        ...appointment.job,
        state: appointment.job.state as Appointment['job']['state'],
      },
      jobId: appointment.jobId,
      locationSource: appointment.locationSource,
      notes: appointment.notes,
      pausedAt: appointment.pausedAt?.toISOString() ?? null,
      postcode: appointment.postcode,
      scheduledEnd: appointment.scheduledEnd.toISOString(),
      scheduledStart: appointment.scheduledStart.toISOString(),
      state: appointment.state as Appointment['state'],
      status: appointment.status,
      suburb: appointment.suburb,
      signature: null,
      totalPausedMinutes: appointment.totalPausedMinutes,
      totalTravelMinutes: appointment.totalTravelMinutes,
      totalWorkMinutes: appointment.totalWorkMinutes,
      travelDistanceKm: appointment.travelDistanceKm
        ? Number(appointment.travelDistanceKm.toString())
        : null,
      travelDurationMinutes: appointment.travelDurationMinutes,
      travelStartedAt: appointment.travelStartedAt?.toISOString() ?? null,
      updatedAt: appointment.updatedAt.toISOString(),
      updatedBy: appointment.updatedBy,
      workStartedAt: appointment.workStartedAt?.toISOString() ?? null,
      workLog: null,
    };
  }

  private appointmentExecutionDurations(
    appointment: Pick<
      AppointmentWithRelations,
      | 'completedAt'
      | 'currentWorkStartedAt'
      | 'pausedAt'
      | 'status'
      | 'totalPausedMinutes'
      | 'totalTravelMinutes'
      | 'totalWorkMinutes'
      | 'travelStartedAt'
      | 'workStartedAt'
    >,
  ) {
    const now = new Date();
    const minutesBetween = (start: Date | null, end: Date) =>
      start
        ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
        : 0;
    const travelMinutes =
      appointment.status === 'ON_THE_WAY' && appointment.travelStartedAt
        ? minutesBetween(appointment.travelStartedAt, now)
        : appointment.totalTravelMinutes;
    const workSegmentStart =
      appointment.currentWorkStartedAt ?? appointment.workStartedAt;
    const workMinutes =
      appointment.status === 'IN_PROGRESS' && workSegmentStart
        ? appointment.totalWorkMinutes + minutesBetween(workSegmentStart, now)
        : appointment.totalWorkMinutes;
    const pausedMinutes =
      appointment.status === 'PAUSED' && appointment.pausedAt
        ? appointment.totalPausedMinutes +
          minutesBetween(appointment.pausedAt, now)
        : appointment.totalPausedMinutes;
    const elapsedStart =
      appointment.travelStartedAt ?? appointment.workStartedAt;
    const elapsedEnd = appointment.completedAt ?? now;

    return {
      calculatedAt: now.toISOString(),
      pausedMinutes,
      totalElapsedMinutes: minutesBetween(elapsedStart, elapsedEnd),
      travelMinutes,
      workMinutes,
    };
  }

  private clean(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private domainError(
    code: string,
    message: string,
    status = HttpStatus.BAD_REQUEST,
    details: Record<string, unknown> = {},
  ) {
    return new HttpException({ code, message, details }, status);
  }
}
