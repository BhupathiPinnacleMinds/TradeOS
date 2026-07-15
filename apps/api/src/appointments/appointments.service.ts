import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  Appointment,
  AppointmentAvailabilityResponse,
  AppointmentDetailResponse,
  AppointmentListResponse,
  AppointmentReassignmentOptionsResponse,
  AppointmentStatus,
  AuthenticatedUser,
} from '@tradieos/shared';
import {
  APPOINTMENT_STATUS_UPDATE_ROLES,
  APPOINTMENT_VIEW_ROLES,
  APPOINTMENT_WRITE_ROLES,
  AUSTRALIAN_STATES,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import type {
  AppointmentRecommendationDto,
  AppointmentAvailabilityDto,
  ListAppointmentsQueryDto,
  ReassignAppointmentDto,
  UpsertAppointmentDto,
} from './dto/appointments.dto';
import { SchedulingService } from './scheduling.service';

const DEFAULT_PAGE_SIZE = 20;
const TECHNICIAN_ROLE = 'TECHNICIAN';
const VIEW_ONLY_ROLES = ['ACCOUNTANT', 'READ_ONLY', 'SALES'] as const;
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: ReturnType<AppointmentsService['appointmentInclude']>;
}>;

type AppointmentJob = Prisma.JobGetPayload<{
  include: { customer: true };
}>;

type AppointmentLocationData = {
  customerSiteId: string | null;
  locationSource: 'CUSTOMER_SITE' | 'CUSTOMER_DEFAULT' | 'MANUAL';
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  accessInstructions: string | null;
};

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly notifications: AppointmentNotificationsService,
  ) {}

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListAppointmentsQueryDto,
  ): Promise<AppointmentListResponse> {
    this.assertRole(currentUser, APPOINTMENT_VIEW_ROLES);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      100,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const where = this.buildWhere(currentUser, query);

    const [records, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        orderBy: this.orderBy(query.sortBy, query.sortOrder),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.appointmentInclude(),
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      records: records.map((appointment) => this.toAppointment(appointment)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findOne(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_VIEW_ROLES);
    const appointment = await this.getAppointmentForUser(currentUser, id);
    return { appointment: this.toAppointment(appointment) };
  }

  async recommend(
    currentUser: AuthenticatedUser,
    dto: AppointmentRecommendationDto,
  ) {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    await this.assertJob(currentUser.businessId, dto.jobId);
    this.assertDateRange(dto.scheduledStart, dto.scheduledEnd);
    return this.scheduling.recommendTechnician(currentUser.businessId, dto);
  }

  async availability(
    currentUser: AuthenticatedUser,
    dto: AppointmentAvailabilityDto,
  ): Promise<AppointmentAvailabilityResponse> {
    this.assertRole(currentUser, APPOINTMENT_VIEW_ROLES);
    this.assertDateRange(dto.scheduledStart, dto.scheduledEnd);
    return this.checkAvailability(currentUser, {
      assignedUserId: dto.assignedUserId ?? null,
      excludeAppointmentId: dto.excludeAppointmentId,
      scheduledEnd: new Date(dto.scheduledEnd),
      scheduledStart: new Date(dto.scheduledStart),
    });
  }

  async create(
    currentUser: AuthenticatedUser,
    dto: UpsertAppointmentDto,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const job = await this.assertJob(currentUser.businessId, dto.jobId);
    await this.assertAssignedUser(currentUser.businessId, dto.assignedUserId);
    const data = await this.normalise(currentUser.businessId, dto, job);
    await this.assertNoConflictOrOverride(currentUser, data, dto);

    const created = await this.prisma.$transaction(async (tx) => {
      const location = await this.createManualSiteIfRequested(
        tx,
        currentUser,
        dto,
        job,
        data,
      );
      const appointmentNumber = await this.nextAppointmentNumber(
        tx as PrismaService,
        currentUser.businessId,
        data.scheduledStart,
      );
      const appointment = await tx.appointment.create({
        data: {
          ...data,
          ...location,
          appointmentNumber,
          businessId: currentUser.businessId,
          createdBy: currentUser.id,
        },
        include: this.appointmentInclude(),
      });
      await this.log(tx, currentUser, 'APPOINTMENT_CREATED', appointment);
      if (appointment.assignedUserId) {
        await this.log(tx, currentUser, 'APPOINTMENT_ASSIGNED', appointment, {
          assignedUserId: appointment.assignedUserId,
        });
      }
      await this.log(
        tx,
        currentUser,
        'JOB_TIMELINE_APPOINTMENT_CREATED',
        appointment,
      );
      return appointment;
    });

    return { appointment: this.toAppointment(created) };
  }

  async update(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpsertAppointmentDto,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const existing = await this.getAppointment(currentUser.businessId, id);
    const job = await this.assertJob(currentUser.businessId, dto.jobId);
    await this.assertAssignedUser(currentUser.businessId, dto.assignedUserId);
    const data = await this.normalise(
      currentUser.businessId,
      dto,
      job,
      existing,
    );
    await this.assertNoConflictOrOverride(currentUser, data, dto, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const location = await this.createManualSiteIfRequested(
        tx,
        currentUser,
        dto,
        job,
        data,
      );
      const appointment = await tx.appointment.update({
        where: { id },
        data: { ...data, ...location, updatedBy: currentUser.id },
        include: this.appointmentInclude(),
      });
      await this.log(tx, currentUser, 'APPOINTMENT_UPDATED', appointment, {
        changedFields: this.changedFields(existing, data),
      });
      if (
        existing.scheduledStart.getTime() !==
          appointment.scheduledStart.getTime() ||
        existing.scheduledEnd.getTime() !== appointment.scheduledEnd.getTime()
      ) {
        await this.log(
          tx,
          currentUser,
          'APPOINTMENT_RESCHEDULED',
          appointment,
          {
            from: {
              assignedUserId: existing.assignedUserId,
              scheduledEnd: existing.scheduledEnd.toISOString(),
              scheduledStart: existing.scheduledStart.toISOString(),
            },
            to: {
              assignedUserId: appointment.assignedUserId,
              scheduledEnd: appointment.scheduledEnd.toISOString(),
              scheduledStart: appointment.scheduledStart.toISOString(),
            },
          },
        );
      }
      if (existing.assignedUserId !== appointment.assignedUserId) {
        await this.log(tx, currentUser, 'APPOINTMENT_ASSIGNED', appointment, {
          assignedUserId: appointment.assignedUserId,
          previousAssignedUserId: existing.assignedUserId,
        });
      }
      return appointment;
    });

    return { appointment: this.toAppointment(updated) };
  }

  async reassignmentOptions(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<AppointmentReassignmentOptionsResponse> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const appointment = await this.getAppointment(currentUser.businessId, id);
    const scheduledStart = appointment.scheduledStart;
    const scheduledEnd = appointment.scheduledEnd;
    const startOfToday = new Date(scheduledStart);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const now = new Date();

    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId: currentUser.businessId,
        role: { in: ['OWNER', 'ADMIN', 'TECHNICIAN'] },
        status: 'ACTIVE',
        userId: { not: null },
      },
      include: {
        user: {
          select: {
            email: true,
            firstName: true,
            id: true,
            lastName: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    const users = members
      .map((member) =>
        member.user
          ? {
              email: member.user.email,
              name: `${member.user.firstName} ${member.user.lastName}`,
              role: member.role,
              userId: member.user.id,
            }
          : null,
      )
      .filter((member): member is NonNullable<typeof member> =>
        Boolean(member),
      );

    const dayAppointments = await this.prisma.appointment.findMany({
      where: {
        assignedUserId: { in: users.map((user) => user.userId) },
        businessId: currentUser.businessId,
        scheduledStart: { gte: startOfToday, lt: startOfTomorrow },
        status: { notIn: [...CLOSED_STATUSES] },
      },
      select: {
        assignedUserId: true,
        scheduledEnd: true,
        scheduledStart: true,
      },
    });

    const recommendation = await this.scheduling.recommendTechnician(
      currentUser.businessId,
      {
        estimatedDurationMinutes: appointment.estimatedDurationMinutes,
        jobId: appointment.jobId,
        priority: appointment.job.priority,
        scheduledEnd: scheduledEnd.toISOString(),
        scheduledStart: scheduledStart.toISOString(),
      },
    );

    const technicians = await Promise.all(
      users.map(async (user) => {
        const availability = await this.checkAvailability(currentUser, {
          assignedUserId: user.userId,
          excludeAppointmentId: appointment.id,
          scheduledEnd,
          scheduledStart,
        });
        return {
          availabilityReason: availability.reason,
          email: user.email,
          isAvailable: !availability.hasConflict,
          name: user.name,
          role: user.role,
          todayWorkload: dayAppointments.filter(
            (item) => item.assignedUserId === user.userId,
          ).length,
          upcomingToday: dayAppointments.filter(
            (item) =>
              item.assignedUserId === user.userId && item.scheduledStart >= now,
          ).length,
          userId: user.userId,
        };
      }),
    );

    const fallback = technicians
      .filter((technician) => technician.isAvailable)
      .sort(
        (left, right) =>
          left.todayWorkload - right.todayWorkload ||
          left.upcomingToday - right.upcomingToday ||
          left.name.localeCompare(right.name),
      )[0];

    return {
      appointment: this.toAppointment(appointment),
      recommendation: {
        reason:
          recommendation.recommendedTechnicianId || !fallback
            ? recommendation.reason
            : 'Lowest workload today with no scheduling conflict.',
        technicianId:
          recommendation.recommendedTechnicianId ?? fallback?.userId ?? null,
        technicianName: recommendation.technicianName ?? fallback?.name ?? null,
      },
      technicians,
    };
  }

  async reassign(
    currentUser: AuthenticatedUser,
    id: string,
    dto: ReassignAppointmentDto,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const existing = await this.getAppointment(currentUser.businessId, id);
    await this.assertAssignedUser(currentUser.businessId, dto.assignedUserId);

    const availability = await this.checkAvailability(currentUser, {
      assignedUserId: dto.assignedUserId ?? null,
      excludeAppointmentId: id,
      scheduledEnd: existing.scheduledEnd,
      scheduledStart: existing.scheduledStart,
    });
    const canOverride =
      dto.allowConflictOverride &&
      ['OWNER', 'ADMIN'].includes(currentUser.role);
    if (availability.hasConflict && !canOverride) {
      throw this.domainError(
        'APPOINTMENT_CONFLICT',
        availability.reason,
        HttpStatus.CONFLICT,
        { availability: { ...availability, canOverride } },
      );
    }

    const previousTechnicianName = this.technicianName(existing.assignedUser);
    const nextTechnicianName = await this.getTechnicianName(
      currentUser.businessId,
      dto.assignedUserId ?? null,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.update({
        where: { id },
        data: {
          assignedUserId: dto.assignedUserId ?? null,
          updatedBy: currentUser.id,
        },
        include: this.appointmentInclude(),
      });
      await this.log(tx, currentUser, 'APPOINTMENT_REASSIGNED', appointment, {
        newTechnicianName: nextTechnicianName,
        previousAssignedUserId: existing.assignedUserId,
        previousTechnicianName,
        reason: this.clean(dto.reason),
        reassignedAt: new Date().toISOString(),
        reassignedByUserId: currentUser.id,
        scheduledEnd: existing.scheduledEnd.toISOString(),
        scheduledStart: existing.scheduledStart.toISOString(),
        assignedUserId: appointment.assignedUserId,
      });
      await this.log(
        tx,
        currentUser,
        'JOB_TIMELINE_APPOINTMENT_REASSIGNED',
        appointment,
        {
          newTechnicianName: nextTechnicianName,
          previousTechnicianName,
        },
      );
      return appointment;
    });

    const appointment = this.toAppointment(updated);
    this.notifications.notifyOldTechnician({
      appointment,
      newTechnicianName: nextTechnicianName,
      oldTechnicianId: existing.assignedUserId,
    });
    this.notifications.notifyNewTechnician({
      appointment,
      newTechnicianId: appointment.assignedUserId,
      previousTechnicianName,
    });

    return { appointment };
  }

  async transition(
    currentUser: AuthenticatedUser,
    id: string,
    status: AppointmentStatus,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_STATUS_UPDATE_ROLES);
    const existing = await this.getAppointmentForUser(currentUser, id);
    const now = new Date();
    const data: Prisma.AppointmentUncheckedUpdateInput = {
      status,
      updatedBy: currentUser.id,
    };
    if (status === 'IN_PROGRESS' && !existing.actualStart) {
      data.actualStart = now;
    }
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      data.actualEnd = now;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.update({
        where: { id },
        data,
        include: this.appointmentInclude(),
      });
      await this.log(
        tx,
        currentUser,
        this.actionForStatus(status),
        appointment,
        {
          from: existing.status,
          to: status,
        },
      );
      return appointment;
    });

    return { appointment: this.toAppointment(updated) };
  }

  private buildWhere(
    currentUser: AuthenticatedUser,
    query: ListAppointmentsQueryDto,
  ): Prisma.AppointmentWhereInput {
    const where: Prisma.AppointmentWhereInput = {
      businessId: currentUser.businessId,
    };
    if (query.status) where.status = query.status;
    if (query.appointmentType) where.appointmentType = query.appointmentType;
    if (query.jobId) where.jobId = query.jobId;
    if (query.customerId) where.job = { customerId: query.customerId };
    if (query.assignedUserId && currentUser.role !== TECHNICIAN_ROLE) {
      where.assignedUserId =
        query.assignedUserId === 'unassigned' ? null : query.assignedUserId;
    }
    if (query.filter) this.applyFilter(where, query.filter, currentUser);
    if (query.dateFrom || query.dateTo) {
      where.scheduledStart = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { appointmentNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { job: { title: { contains: search, mode: 'insensitive' } } },
        { job: { jobNumber: { contains: search, mode: 'insensitive' } } },
        {
          job: {
            customer: {
              displayName: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }
    if (currentUser.role === TECHNICIAN_ROLE) {
      where.assignedUserId = currentUser.id;
    }
    return where;
  }

  private applyFilter(
    where: Prisma.AppointmentWhereInput,
    filter: NonNullable<ListAppointmentsQueryDto['filter']>,
    currentUser: AuthenticatedUser,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    if (filter === 'today') where.scheduledStart = { gte: today, lt: tomorrow };
    if (filter === 'tomorrow') {
      where.scheduledStart = { gte: tomorrow, lt: dayAfterTomorrow };
    }
    if (filter === 'upcoming') {
      where.scheduledStart = { gte: tomorrow };
      where.status = { notIn: [...CLOSED_STATUSES] };
    }
    if (filter === 'completed') where.status = 'COMPLETED';
    if (filter === 'cancelled') where.status = 'CANCELLED';
    if (filter === 'my-appointments') where.assignedUserId = currentUser.id;
  }

  private orderBy(
    sortBy: ListAppointmentsQueryDto['sortBy'] = 'scheduledStart',
    sortOrder: ListAppointmentsQueryDto['sortOrder'] = 'asc',
  ): Prisma.AppointmentOrderByWithRelationInput[] {
    return [{ [sortBy]: sortOrder }, { createdAt: 'desc' }];
  }

  private async normalise(
    businessId: string,
    dto: UpsertAppointmentDto,
    job: AppointmentJob,
    existing?: AppointmentWithRelations,
  ) {
    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);
    this.assertDateRange(dto.scheduledStart, dto.scheduledEnd);
    const location = await this.resolveLocation(businessId, dto, job);
    return {
      appointmentType: dto.appointmentType,
      assignedUserId: dto.assignedUserId || null,
      estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
      jobId: dto.jobId,
      ...location,
      notes: this.clean(dto.notes),
      scheduledEnd,
      scheduledStart,
      status: this.normaliseActiveStatus(dto.status, existing?.status),
      travelDistanceKm: dto.travelDistanceKm ?? null,
      travelDurationMinutes: dto.travelDurationMinutes ?? null,
    };
  }

  private normaliseActiveStatus(
    requested?: AppointmentStatus,
    existing?: AppointmentStatus,
  ): AppointmentStatus {
    if (requested === 'RESCHEDULED') {
      return existing === 'CONFIRMED' ? 'CONFIRMED' : 'SCHEDULED';
    }
    return requested ?? existing ?? 'SCHEDULED';
  }

  private async resolveLocation(
    businessId: string,
    dto: UpsertAppointmentDto,
    job: AppointmentJob,
  ): Promise<AppointmentLocationData> {
    const source = dto.locationSource ?? 'CUSTOMER_DEFAULT';

    if (source === 'CUSTOMER_SITE') {
      if (!dto.customerSiteId) {
        throw this.domainError(
          'INVALID_APPOINTMENT_DATA',
          'Choose a customer service site for this appointment.',
        );
      }
      const site = await this.prisma.customerSite.findFirst({
        where: {
          businessId,
          customerId: job.customerId,
          id: dto.customerSiteId,
          isArchived: false,
        },
      });
      if (!site) {
        throw this.domainError(
          'CUSTOMER_SITE_NOT_FOUND',
          'Customer service site not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      return {
        accessInstructions: site.accessInstructions,
        addressLine1: site.addressLine1,
        addressLine2: site.addressLine2,
        customerSiteId: site.id,
        locationSource: source,
        postcode: site.postcode,
        state: site.state,
        suburb: site.suburb,
      };
    }

    if (source === 'MANUAL') {
      return {
        ...this.validateManualAddress(dto),
        customerSiteId: null,
        locationSource: source,
      };
    }

    if (
      !job.customer.addressLine1 ||
      !job.customer.suburb ||
      !job.customer.state ||
      !job.customer.postcode
    ) {
      throw this.domainError(
        'INVALID_APPOINTMENT_DATA',
        'Customer default address is incomplete. Choose a service site or enter a different address.',
      );
    }

    return {
      accessInstructions: null,
      addressLine1: job.customer.addressLine1,
      addressLine2: job.customer.addressLine2,
      customerSiteId: null,
      locationSource: 'CUSTOMER_DEFAULT',
      postcode: job.customer.postcode,
      state: job.customer.state,
      suburb: job.customer.suburb,
    };
  }

  private validateManualAddress(
    dto: UpsertAppointmentDto,
  ): Omit<AppointmentLocationData, 'customerSiteId' | 'locationSource'> {
    const addressLine1 = this.clean(dto.addressLine1);
    const suburb = this.clean(dto.suburb);
    const state = this.clean(dto.state);
    const postcode = this.clean(dto.postcode);

    if (!addressLine1 || !suburb || !state || !postcode) {
      throw this.domainError(
        'INVALID_APPOINTMENT_DATA',
        'Manual appointment address requires address line 1, suburb, state and postcode.',
      );
    }
    if (!AUSTRALIAN_STATES.includes(state as never)) {
      throw this.domainError(
        'INVALID_APPOINTMENT_DATA',
        'State must be a valid Australian state or territory.',
      );
    }
    if (!/^\d{4}$/.test(postcode)) {
      throw this.domainError(
        'INVALID_APPOINTMENT_DATA',
        'Postcode must be exactly 4 digits.',
      );
    }

    return {
      accessInstructions: this.clean(dto.accessInstructions),
      addressLine1,
      addressLine2: this.clean(dto.addressLine2),
      postcode,
      state,
      suburb,
    };
  }

  private async createManualSiteIfRequested(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    dto: UpsertAppointmentDto,
    job: AppointmentJob,
    data: AppointmentLocationData,
  ): Promise<Pick<AppointmentLocationData, 'customerSiteId'>> {
    if (data.locationSource !== 'MANUAL' || !dto.saveAddressAsCustomerSite) {
      return { customerSiteId: data.customerSiteId };
    }

    const site = await tx.customerSite.create({
      data: {
        accessInstructions: data.accessInstructions,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        businessId: currentUser.businessId,
        customerId: job.customerId,
        label: 'Appointment address',
        postcode: data.postcode,
        state: data.state,
        suburb: data.suburb,
      },
    });
    await this.log(tx, currentUser, 'CUSTOMER_SITE_CREATED_FROM_APPOINTMENT', {
      id: site.id,
      jobId: job.id,
    });
    return { customerSiteId: site.id };
  }

  private async assertNoConflictOrOverride(
    currentUser: AuthenticatedUser,
    data: {
      assignedUserId: string | null;
      scheduledEnd: Date;
      scheduledStart: Date;
    },
    dto: Pick<UpsertAppointmentDto, 'allowConflictOverride'>,
    excludeAppointmentId?: string,
  ) {
    const availability = await this.checkAvailability(currentUser, {
      assignedUserId: data.assignedUserId,
      excludeAppointmentId,
      scheduledEnd: data.scheduledEnd,
      scheduledStart: data.scheduledStart,
    });
    if (!availability.hasConflict) return;
    if (currentUser.role === 'OWNER' && dto.allowConflictOverride) return;

    throw this.domainError(
      'APPOINTMENT_CONFLICT',
      availability.reason,
      HttpStatus.CONFLICT,
      { availability },
    );
  }

  private async checkAvailability(
    currentUser: AuthenticatedUser,
    input: {
      assignedUserId: string | null;
      scheduledStart: Date;
      scheduledEnd: Date;
      excludeAppointmentId?: string;
    },
  ): Promise<AppointmentAvailabilityResponse> {
    if (!this.isInsideWorkingHours(input.scheduledStart, input.scheduledEnd)) {
      return {
        canOverride: currentUser.role === 'OWNER',
        conflicts: [],
        hasConflict: true,
        reason: 'Appointment is outside business working hours.',
      };
    }

    if (!input.assignedUserId) {
      return {
        canOverride: true,
        conflicts: [],
        hasConflict: false,
        reason: 'No technician assigned yet.',
      };
    }

    const where: Prisma.AppointmentWhereInput = {
      businessId: currentUser.businessId,
      assignedUserId: input.assignedUserId,
      scheduledEnd: { gt: input.scheduledStart },
      scheduledStart: { lt: input.scheduledEnd },
      status: { notIn: [...CLOSED_STATUSES] },
    };
    if (input.excludeAppointmentId) {
      where.id = { not: input.excludeAppointmentId };
    }

    const conflicts = await this.prisma.appointment.findMany({
      where,
      include: {
        assignedUser: {
          select: { firstName: true, lastName: true },
        },
        job: { select: { title: true } },
      },
    });

    return {
      canOverride: currentUser.role === 'OWNER',
      conflicts: conflicts.map((conflict) => ({
        appointmentNumber: conflict.appointmentNumber,
        id: conflict.id,
        jobTitle: conflict.job.title,
        scheduledEnd: conflict.scheduledEnd.toISOString(),
        scheduledStart: conflict.scheduledStart.toISOString(),
        technicianName: conflict.assignedUser
          ? `${conflict.assignedUser.firstName} ${conflict.assignedUser.lastName}`
          : null,
      })),
      hasConflict: conflicts.length > 0,
      reason:
        conflicts.length > 0
          ? 'Technician already has an overlapping appointment.'
          : 'Technician is available for this appointment.',
    };
  }

  private isInsideWorkingHours(start: Date, end: Date) {
    return start < end && start.getHours() >= 7 && end.getHours() <= 18;
  }

  private assertDateRange(start: string, end: string) {
    const scheduledStart = new Date(start);
    const scheduledEnd = new Date(end);
    if (scheduledEnd <= scheduledStart) {
      throw this.domainError(
        'INVALID_APPOINTMENT_DATA',
        'Scheduled end must be after scheduled start.',
      );
    }
  }

  private async getAppointmentForUser(
    currentUser: AuthenticatedUser,
    id: string,
  ) {
    const appointment = await this.getAppointment(currentUser.businessId, id);
    if (
      currentUser.role === TECHNICIAN_ROLE &&
      appointment.assignedUserId !== currentUser.id
    ) {
      throw this.domainError(
        'APPOINTMENT_NOT_FOUND',
        'Appointment not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return appointment;
  }

  private async getAppointment(businessId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { businessId, id },
      include: this.appointmentInclude(),
    });
    if (!appointment) {
      throw this.domainError(
        'APPOINTMENT_NOT_FOUND',
        'Appointment not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return appointment;
  }

  private async assertJob(businessId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { businessId, id: jobId, isArchived: false },
      include: { customer: true },
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

  private async assertAssignedUser(
    businessId: string,
    assignedUserId?: string | null,
  ) {
    if (!assignedUserId) return;
    const member = await this.prisma.businessMember.findFirst({
      where: {
        businessId,
        status: 'ACTIVE',
        user: { id: assignedUserId, isActive: true },
        userId: assignedUserId,
      },
      select: { id: true },
    });
    if (!member) {
      throw this.domainError(
        'ASSIGNEE_NOT_FOUND',
        'Assigned technician is not available in this business.',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async getTechnicianName(
    businessId: string,
    assignedUserId: string | null,
  ) {
    if (!assignedUserId) return 'Unassigned';
    const member = await this.prisma.businessMember.findFirst({
      where: {
        businessId,
        status: 'ACTIVE',
        userId: assignedUserId,
      },
      include: {
        user: {
          select: { firstName: true, lastName: true },
        },
      },
    });
    return member?.user
      ? `${member.user.firstName} ${member.user.lastName}`
      : 'Unassigned';
  }

  private technicianName(
    user: AppointmentWithRelations['assignedUser'] | null,
  ) {
    return user ? `${user.firstName} ${user.lastName}` : 'Unassigned';
  }

  private assertRole(
    currentUser: AuthenticatedUser,
    allowedRoles: readonly string[],
  ) {
    if (!allowedRoles.includes(currentUser.role)) {
      throw this.domainError(
        'INSUFFICIENT_PERMISSION',
        'You do not have permission to manage appointments.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      VIEW_ONLY_ROLES.includes(currentUser.role as never) &&
      allowedRoles !== APPOINTMENT_VIEW_ROLES
    ) {
      throw this.domainError(
        'INSUFFICIENT_PERMISSION',
        'This role can only view appointments.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async nextAppointmentNumber(
    tx: PrismaService,
    businessId: string,
    scheduledStart: Date,
  ) {
    const existing = await tx.appointmentSequence.findUnique({
      where: { businessId },
    });
    const nextNumber = existing?.nextNumber ?? 1;
    if (existing) {
      await tx.appointmentSequence.update({
        where: { businessId },
        data: { nextNumber: { increment: 1 } },
      });
    } else {
      await tx.appointmentSequence.create({
        data: { businessId, nextNumber: 2 },
      });
    }
    return `APT-${scheduledStart.getFullYear()}-${String(nextNumber).padStart(6, '0')}`;
  }

  private changedFields(
    existing: AppointmentWithRelations,
    data: Record<string, unknown>,
  ) {
    return Object.entries(data)
      .filter(
        ([key, value]) =>
          JSON.stringify(existing[key as keyof AppointmentWithRelations]) !==
          JSON.stringify(value),
      )
      .map(([key]) => key);
  }

  private async log(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    action: string,
    appointment: { id: string; jobId: string },
    metadata: Record<string, unknown> = {},
  ) {
    await tx.auditLog.create({
      data: {
        action,
        businessId: currentUser.businessId,
        actorUserId: currentUser.id,
        entityId: appointment.id,
        entityType: 'Appointment',
        metadata: { jobId: appointment.jobId, ...metadata },
      },
    });
  }

  private actionForStatus(status: AppointmentStatus) {
    if (status === 'IN_PROGRESS') return 'APPOINTMENT_STARTED';
    if (status === 'ARRIVED') return 'APPOINTMENT_ARRIVED';
    if (status === 'COMPLETED') return 'APPOINTMENT_COMPLETED';
    if (status === 'CANCELLED') return 'APPOINTMENT_CANCELLED';
    if (status === 'ON_THE_WAY') return 'APPOINTMENT_ON_THE_WAY';
    if (status === 'NO_SHOW') return 'APPOINTMENT_NO_SHOW';
    if (status === 'RESCHEDULED') return 'APPOINTMENT_RESCHEDULED';
    return 'APPOINTMENT_UPDATED';
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

  private toAppointment(appointment: AppointmentWithRelations): Appointment {
    return {
      actualEnd: appointment.actualEnd?.toISOString() ?? null,
      actualStart: appointment.actualStart?.toISOString() ?? null,
      accessInstructions: appointment.accessInstructions,
      addressLine1: appointment.addressLine1,
      addressLine2: appointment.addressLine2,
      appointmentNumber: appointment.appointmentNumber,
      appointmentType: appointment.appointmentType,
      assignedUser: appointment.assignedUser,
      assignedUserId: appointment.assignedUserId,
      businessId: appointment.businessId,
      createdAt: appointment.createdAt.toISOString(),
      createdBy: appointment.createdBy,
      customerSiteId: appointment.customerSiteId,
      estimatedDurationMinutes: appointment.estimatedDurationMinutes,
      id: appointment.id,
      job: {
        ...appointment.job,
        state: appointment.job.state as Appointment['job']['state'],
      },
      jobId: appointment.jobId,
      locationSource: appointment.locationSource,
      notes: appointment.notes,
      postcode: appointment.postcode,
      scheduledEnd: appointment.scheduledEnd.toISOString(),
      scheduledStart: appointment.scheduledStart.toISOString(),
      state: appointment.state as Appointment['state'],
      status: appointment.status,
      suburb: appointment.suburb,
      travelDistanceKm: appointment.travelDistanceKm
        ? Number(appointment.travelDistanceKm.toString())
        : null,
      travelDurationMinutes: appointment.travelDurationMinutes,
      updatedAt: appointment.updatedAt.toISOString(),
      updatedBy: appointment.updatedBy,
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
