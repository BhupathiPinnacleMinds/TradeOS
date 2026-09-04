import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  Appointment,
  AppointmentAvailabilityResponse,
  AppointmentDetailResponse,
  AppointmentExecutionDurations,
  AppointmentListResponse,
  AppointmentReassignmentOptionsResponse,
  AppointmentSignature,
  AppointmentStatus,
  AuthenticatedUser,
  CompleteAppointmentPayload,
  DispatcherFilter,
  DispatcherTechnicianStatus,
  DispatcherViewResponse,
  MyDayResponse,
} from '@tradieos/shared';
import {
  APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES,
  APPOINTMENT_CONFIRM_ROLES,
  APPOINTMENT_STATUS_UPDATE_ROLES,
  APPOINTMENT_VIEW_ROLES,
  APPOINTMENT_WRITE_ROLES,
  AUSTRALIAN_STATES,
  getBusinessDayRangeUtc,
  getAllowedAppointmentTransitions,
  getBusinessDateParts,
  hasAppointmentValidationErrors,
  validateAppointmentCompletion,
  validateAppointmentFieldWork,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { CustomerCommunicationsService } from '../communications/communications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import type {
  AppointmentRecommendationDto,
  AppointmentAvailabilityDto,
  AppointmentWorkLogDto,
  CaptureAppointmentSignatureDto,
  CompleteAppointmentDto,
  DispatcherQueryDto,
  ListAppointmentsQueryDto,
  ReassignAppointmentDto,
  SkipAppointmentSignatureDto,
  UpsertAppointmentDto,
} from './dto/appointments.dto';
import { SchedulingService } from './scheduling.service';

const DEFAULT_PAGE_SIZE = 20;
const TECHNICIAN_ROLE = 'TECHNICIAN';
const VIEW_ONLY_ROLES = ['ACCOUNTANT', 'READ_ONLY', 'SALES'] as const;
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
const NON_ACTIONABLE_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;
const REMAINING_MY_DAY_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'ON_THE_WAY',
  'ARRIVED',
  'IN_PROGRESS',
  'PAUSED',
] as const;
const CURRENT_MY_DAY_STATUSES = [
  'IN_PROGRESS',
  'PAUSED',
  'ARRIVED',
  'ON_THE_WAY',
] as const;
const SIGNATURE_SKIP_ROLES = ['OWNER', 'ADMIN'] as const;
const SIGNATURE_CONSENT_TEXT =
  'I confirm the work described above has been completed.';
const DISPATCHER_MANAGE_ROLES = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
] as const;
const DISPATCHER_TECHNICIAN_ROLES = APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES;
const WORKDAY_MINUTES = 8 * 60;
const TRAVEL_PLACEHOLDER_MINUTES = 10;
const APPOINTMENT_CREATION_CLOCK_SKEW_MS = 2 * 60 * 1000;
const APPOINTMENT_EXECUTION_GRACE_MS = 60 * 60 * 1000;

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
    private readonly communications: CustomerCommunicationsService,
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

  async dispatcher(
    currentUser: AuthenticatedUser,
    query: DispatcherQueryDto,
  ): Promise<DispatcherViewResponse> {
    this.assertRole(currentUser, DISPATCHER_MANAGE_ROLES);
    const selectedDate = query.date ? new Date(query.date) : new Date();
    const business = await this.prisma.business.findUnique({
      where: { id: currentUser.businessId },
      select: { timezone: true },
    });
    const { end: endOfDay, start: startOfDay } = getBusinessDayRangeUtc(
      selectedDate,
      business?.timezone,
    );
    const now = new Date();
    const canManage = DISPATCHER_MANAGE_ROLES.includes(
      currentUser.role as never,
    );
    const search = query.search?.trim().toLowerCase() ?? '';

    const [members, appointments] = await this.prisma.$transaction([
      this.prisma.businessMember.findMany({
        where: {
          businessId: currentUser.businessId,
          role: { in: [...DISPATCHER_TECHNICIAN_ROLES] },
          status: 'ACTIVE',
          userId: { not: null },
          ...(currentUser.role === TECHNICIAN_ROLE
            ? { userId: currentUser.id }
            : {}),
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
      }),
      this.prisma.appointment.findMany({
        where: {
          businessId: currentUser.businessId,
          scheduledStart: { gte: startOfDay, lt: endOfDay },
          ...(currentUser.role === TECHNICIAN_ROLE
            ? { assignedUserId: currentUser.id }
            : {}),
        },
        include: this.appointmentInclude(),
        orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        action: 'DISPATCHER_VIEWED',
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: null,
        entityType: 'Dispatcher',
        metadata: {
          date: startOfDay.toISOString(),
          filter: query.filter ?? null,
          search: query.search ?? null,
        },
      },
    });

    const unassignedAppointments = appointments.filter(
      (appointment) => !appointment.assignedUserId,
    );
    const unassigned = await Promise.all(
      unassignedAppointments.map(async (appointment) => {
        const recommendation = await this.scheduling.recommendTechnician(
          currentUser.businessId,
          {
            estimatedDurationMinutes: appointment.estimatedDurationMinutes,
            jobId: appointment.jobId,
            priority: appointment.job.priority,
            scheduledEnd: appointment.scheduledEnd.toISOString(),
            scheduledStart: appointment.scheduledStart.toISOString(),
          },
        );
        return {
          appointment: this.toAppointment(appointment),
          recommendation: {
            reason: recommendation.reason,
            technicianId: recommendation.recommendedTechnicianId,
            technicianName: recommendation.technicianName,
          },
        };
      }),
    );

    const technicians = members
      .map((member) => {
        if (!member.user) return null;
        const technicianAppointments = appointments.filter(
          (appointment) => appointment.assignedUserId === member.user?.id,
        );
        const estimatedWorkMinutes = technicianAppointments.reduce(
          (sum, appointment) => sum + this.appointmentDuration(appointment),
          0,
        );
        const travelPlaceholderMinutes =
          technicianAppointments.length * TRAVEL_PLACEHOLDER_MINUTES;
        const availableMinutes =
          WORKDAY_MINUTES - estimatedWorkMinutes - travelPlaceholderMinutes;
        const completedToday = technicianAppointments.filter(
          (appointment) => appointment.status === 'COMPLETED',
        ).length;
        const upcomingToday = technicianAppointments.filter(
          (appointment) =>
            appointment.scheduledStart >= now &&
            !CLOSED_STATUSES.includes(appointment.status as never),
        ).length;
        const status = this.dispatcherStatus(technicianAppointments, now);
        return {
          appointments: technicianAppointments.map((appointment) => ({
            appointment: this.toAppointment(appointment),
          })),
          availableMinutes,
          avatarInitials: this.initials(
            member.user.firstName,
            member.user.lastName,
          ),
          completedToday,
          currentStatus: status,
          email: member.user.email,
          estimatedWorkMinutes,
          name: `${member.user.firstName} ${member.user.lastName}`,
          overtimeWarning: availableMinutes < 0,
          role: member.role,
          todaysWorkload: technicianAppointments.length,
          travelPlaceholderMinutes,
          upcomingToday,
          userId: member.user.id,
          workingHours: '8:00 - 4:00',
        };
      })
      .filter((technician): technician is NonNullable<typeof technician> =>
        Boolean(technician),
      );

    const filteredTechnicians = technicians.filter((technician) =>
      this.matchesDispatcherFilters(technician, search, query.filter),
    );
    const filteredUnassigned = unassigned.filter((item) =>
      this.matchesAppointmentSearch(item.appointment, search),
    );
    const estimatedWorkMinutes = technicians.reduce(
      (sum, technician) => sum + technician.estimatedWorkMinutes,
      0,
    );
    const travelPlaceholderMinutes = technicians.reduce(
      (sum, technician) => sum + technician.travelPlaceholderMinutes,
      0,
    );
    const availableMinutes = technicians.reduce(
      (sum, technician) => sum + technician.availableMinutes,
      0,
    );

    return {
      canManage,
      date: startOfDay.toISOString(),
      filters: [
        'working',
        'available',
        'completed',
        'high-priority',
        'overdue',
        'unassigned',
      ],
      summary: {
        availableMinutes,
        availableTechnicians: technicians.filter(
          (technician) => technician.currentStatus === 'AVAILABLE',
        ).length,
        estimatedWorkMinutes,
        overtimeWarning: technicians.some(
          (technician) => technician.overtimeWarning,
        ),
        techniciansWorking: technicians.filter((technician) =>
          ['TRAVELLING', 'WORKING', 'ON_BREAK'].includes(
            technician.currentStatus,
          ),
        ).length,
        totalAppointmentsToday: appointments.length,
        travelPlaceholderMinutes,
        unassignedAppointments: unassigned.length,
      },
      technicians: query.filter === 'unassigned' ? [] : filteredTechnicians,
      unassigned:
        query.filter && query.filter !== 'unassigned' ? [] : filteredUnassigned,
    };
  }

  async myDay(currentUser: AuthenticatedUser): Promise<MyDayResponse> {
    this.assertRole(currentUser, APPOINTMENT_VIEW_ROLES);

    const business = await this.prisma.business.findUnique({
      where: { id: currentUser.businessId },
      select: { name: true, timezone: true },
    });
    if (!business) {
      throw this.domainError(
        'BUSINESS_NOT_FOUND',
        'Business workspace not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const { end, start } = getBusinessDayRangeUtc(
      new Date(),
      business.timezone,
    );

    const [appointments, completedTodayAppointments] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          assignedUserId: currentUser.id,
          businessId: currentUser.businessId,
          scheduledStart: { gte: start, lt: end },
        },
        include: this.appointmentInclude(),
        orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.appointment.findMany({
        where: {
          assignedUserId: currentUser.id,
          businessId: currentUser.businessId,
          completedAt: { gte: start, lt: end },
          status: 'COMPLETED',
        },
        include: this.appointmentInclude(),
        orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      }),
    ]);
    const now = new Date();
    const mapped = appointments.map((appointment) =>
      this.toAppointment(appointment),
    );
    const remaining = mapped.filter(
      (appointment) =>
        REMAINING_MY_DAY_STATUSES.includes(appointment.status as never) &&
        !this.isExpiredUnstartedAppointment(appointment, now),
    );
    const completedToday = [
      ...new Map(
        completedTodayAppointments
          .map((appointment) => this.toAppointment(appointment))
          .map((appointment) => [appointment.id, appointment]),
      ).values(),
    ];
    const allMyDayAppointments = [
      ...new Map(
        [...mapped, ...completedToday].map((appointment) => [
          appointment.id,
          appointment,
        ]),
      ).values(),
    ];
    const currentAppointment =
      CURRENT_MY_DAY_STATUSES.map((status) =>
        remaining.find((appointment) => appointment.status === status),
      ).find(Boolean) ?? null;
    const nextUpcomingAppointment =
      remaining.find(
        (appointment) =>
          ['SCHEDULED', 'CONFIRMED'].includes(appointment.status) &&
          new Date(appointment.scheduledEnd) >= now,
      ) ?? null;
    let nextAppointment = currentAppointment ?? nextUpcomingAppointment;
    if (!nextAppointment) {
      const futureAppointment = await this.prisma.appointment.findFirst({
        where: {
          assignedUserId: currentUser.id,
          businessId: currentUser.businessId,
          scheduledStart: { gte: end },
          status: { in: [...REMAINING_MY_DAY_STATUSES] },
        },
        include: this.appointmentInclude(),
        orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'asc' }],
      });
      const mappedFutureAppointment = futureAppointment
        ? this.toAppointment(futureAppointment)
        : null;
      nextAppointment =
        mappedFutureAppointment &&
        mappedFutureAppointment.assignedUserId === currentUser.id &&
        mappedFutureAppointment.businessId === currentUser.businessId &&
        REMAINING_MY_DAY_STATUSES.includes(
          mappedFutureAppointment.status as never,
        )
          ? mappedFutureAppointment
          : null;
    }
    const laterToday = remaining.filter(
      (appointment) => appointment.id !== nextAppointment?.id,
    );

    return {
      appointments: allMyDayAppointments,
      businessDate: start.toISOString(),
      businessName: business.name,
      businessTimezone: business.timezone,
      completedCount: completedToday.length,
      completedToday,
      laterToday,
      nextAppointment,
      remainingCount: remaining.length,
      technicianName:
        [currentUser.firstName, currentUser.lastName]
          .filter(Boolean)
          .join(' ') || currentUser.email,
      technicianUserId: currentUser.id,
      urgentCount: mapped.filter(
        (appointment) =>
          appointment.job.priority === 'URGENT' &&
          REMAINING_MY_DAY_STATUSES.includes(appointment.status as never) &&
          !this.isExpiredUnstartedAppointment(appointment, now),
      ).length,
    };
  }

  async create(
    currentUser: AuthenticatedUser,
    dto: UpsertAppointmentDto,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const job = await this.assertJob(currentUser.businessId, dto.jobId);
    await this.assertAssignedUser(currentUser.businessId, dto.assignedUserId);
    const data = await this.normalise(currentUser.businessId, dto, job);
    this.assertNewAppointmentIsNotInPast(data.scheduledStart);
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
      await this.communications.appointmentCreated(
        tx,
        currentUser,
        appointment,
      );
      return appointment;
    });

    const appointment = this.toAppointment(created);
    await this.notifications.notifyAssigned({
      actor: currentUser,
      appointment,
    });

    return { appointment };
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
        await this.communications.appointmentRescheduled(
          tx,
          currentUser,
          appointment,
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

    const appointment = this.toAppointment(updated);
    if (
      existing.scheduledStart.getTime() !== updated.scheduledStart.getTime() ||
      existing.scheduledEnd.getTime() !== updated.scheduledEnd.getTime()
    ) {
      await this.notifications.notifyRescheduled({
        actor: currentUser,
        appointment,
      });
    }
    if (existing.assignedUserId !== appointment.assignedUserId) {
      await this.notifications.notifyNewTechnician({
        actor: currentUser,
        appointment,
        newTechnicianId: appointment.assignedUserId,
        previousTechnicianName: this.technicianName(existing.assignedUser),
      });
    }

    return { appointment };
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
        role: { in: [...APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES] },
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
    if (
      ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'].includes(
        existing.status,
      )
    ) {
      throw this.domainError(
        'INVALID_STATUS_TRANSITION',
        'Completed or inactive appointments cannot be reassigned.',
        HttpStatus.CONFLICT,
        { status: existing.status },
      );
    }
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
      actor: currentUser,
      appointment,
      newTechnicianName: nextTechnicianName,
      oldTechnicianId: existing.assignedUserId,
    });
    await this.notifications.notifyNewTechnician({
      actor: currentUser,
      appointment,
      newTechnicianId: appointment.assignedUserId,
      previousTechnicianName,
    });

    return { appointment };
  }

  async updateWorkLog(
    currentUser: AuthenticatedUser,
    id: string,
    dto: AppointmentWorkLogDto,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_STATUS_UPDATE_ROLES);
    const existing = await this.getAppointmentForUser(currentUser, id);
    this.assertValidFieldWork(dto);
    const workLogData = this.workLogData(currentUser, existing, dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.appointmentWorkLog.upsert({
        create: workLogData,
        update: {
          followUpNotes: workLogData.followUpNotes,
          followUpRequired: workLogData.followUpRequired,
          technicianNotes: workLogData.technicianNotes,
          workCompleted: workLogData.workCompleted,
        },
        where: {
          businessId_appointmentId: {
            appointmentId: existing.id,
            businessId: currentUser.businessId,
          },
        },
      });
      await this.log(
        tx,
        currentUser,
        'APPOINTMENT_WORK_LOG_UPDATED',
        existing,
        {
          followUpRequired: workLogData.followUpRequired,
        },
      );
      if (workLogData.followUpRequired) {
        await this.log(tx, currentUser, 'FOLLOW_UP_REQUIRED', existing, {
          followUpNotes: workLogData.followUpNotes,
        });
      }
      return tx.appointment.findFirstOrThrow({
        where: { businessId: currentUser.businessId, id },
        include: this.appointmentInclude(),
      });
    });

    return { appointment: this.toAppointment(updated) };
  }

  async completeWithWorkLog(
    currentUser: AuthenticatedUser,
    id: string,
    dto: CompleteAppointmentDto,
  ): Promise<AppointmentDetailResponse> {
    return this.transition(currentUser, id, 'COMPLETED', dto);
  }

  async captureSignature(
    currentUser: AuthenticatedUser,
    id: string,
    dto: CaptureAppointmentSignatureDto,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_STATUS_UPDATE_ROLES);
    const existing = await this.getAppointmentForUser(currentUser, id);
    if (CLOSED_STATUSES.includes(existing.status as never)) {
      throw this.domainError(
        'SIGNATURE_NOT_AVAILABLE',
        'Signatures can only be captured before an appointment is closed.',
        HttpStatus.CONFLICT,
      );
    }
    const customerName = this.clean(dto.customerName);
    if (!customerName) {
      throw this.domainError(
        'SIGNATURE_CUSTOMER_NAME_REQUIRED',
        'Enter the customer name before saving the signature.',
      );
    }
    if (!this.hasSignatureStrokes(dto.signatureData)) {
      throw this.domainError(
        'SIGNATURE_REQUIRED',
        'Ask the customer to sign before saving.',
      );
    }

    const capturedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.appointmentSignature.upsert({
        create: {
          appointmentId: existing.id,
          businessId: currentUser.businessId,
          capturedAt,
          capturedByUserId: currentUser.id,
          consentText: this.clean(dto.consentText) ?? SIGNATURE_CONSENT_TEXT,
          customerName,
          jobId: existing.jobId,
          signatureData: dto.signatureData as unknown as Prisma.InputJsonValue,
          signerTitle: this.clean(dto.signerTitle),
        },
        update: {
          capturedAt,
          capturedByUserId: currentUser.id,
          consentText: this.clean(dto.consentText) ?? SIGNATURE_CONSENT_TEXT,
          customerName,
          signatureData: dto.signatureData as unknown as Prisma.InputJsonValue,
          signerTitle: this.clean(dto.signerTitle),
          skipReason: null,
          skippedAt: null,
        },
        where: {
          businessId_appointmentId: {
            appointmentId: existing.id,
            businessId: currentUser.businessId,
          },
        },
      });
      await this.log(
        tx,
        currentUser,
        'APPOINTMENT_SIGNATURE_CAPTURED',
        existing,
        {
          capturedAt: capturedAt.toISOString(),
          customerName,
        },
      );
      return tx.appointment.findFirstOrThrow({
        where: { businessId: currentUser.businessId, id },
        include: this.appointmentInclude(),
      });
    });

    return { appointment: this.toAppointment(updated) };
  }

  async skipSignature(
    currentUser: AuthenticatedUser,
    id: string,
    dto: SkipAppointmentSignatureDto,
  ): Promise<AppointmentDetailResponse> {
    if (!SIGNATURE_SKIP_ROLES.includes(currentUser.role as never)) {
      throw this.domainError(
        'SIGNATURE_SKIP_NOT_ALLOWED',
        'Only an owner or admin can skip customer signature capture.',
        HttpStatus.FORBIDDEN,
      );
    }
    const existing = await this.getAppointmentForUser(currentUser, id);
    const reason = this.clean(dto.reason);
    if (!reason) {
      throw this.domainError(
        'SIGNATURE_SKIP_REASON_REQUIRED',
        'Add a reason before skipping the customer signature.',
      );
    }
    const skippedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.upsertSkippedSignature(
        tx,
        currentUser,
        existing,
        reason,
        skippedAt,
      );
      return tx.appointment.findFirstOrThrow({
        where: { businessId: currentUser.businessId, id },
        include: this.appointmentInclude(),
      });
    });

    return { appointment: this.toAppointment(updated) };
  }

  async transition(
    currentUser: AuthenticatedUser,
    id: string,
    status: AppointmentStatus,
    completion?: CompleteAppointmentPayload,
  ): Promise<AppointmentDetailResponse> {
    this.assertRole(currentUser, APPOINTMENT_STATUS_UPDATE_ROLES);
    const existing = await this.getAppointmentForUser(currentUser, id);
    if (existing.status === status) {
      return { appointment: this.toAppointment(existing) };
    }
    if (status === 'CONFIRMED') {
      this.assertRole(currentUser, APPOINTMENT_CONFIRM_ROLES);
    }
    this.assertAllowedTransition(currentUser, existing, status);
    if (status === 'COMPLETED') {
      this.assertValidCompletion(currentUser, existing, completion);
      this.assertCompletionSignatureRequirement(
        currentUser,
        existing,
        completion,
      );
    }
    const now = new Date();
    this.assertTransitionWindow(existing, status, now);
    const data: Prisma.AppointmentUncheckedUpdateInput = {
      status,
      updatedBy: currentUser.id,
    };
    this.applyExecutionTiming(data, existing, status, now);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (completion) {
        const workLogData = this.workLogData(currentUser, existing, completion);
        await tx.appointmentWorkLog.upsert({
          create: workLogData,
          update: {
            followUpNotes: workLogData.followUpNotes,
            followUpRequired: workLogData.followUpRequired,
            technicianNotes: workLogData.technicianNotes,
            workCompleted: workLogData.workCompleted,
          },
          where: {
            businessId_appointmentId: {
              appointmentId: existing.id,
              businessId: currentUser.businessId,
            },
          },
        });
        await this.log(
          tx,
          currentUser,
          'APPOINTMENT_WORK_LOG_UPDATED',
          existing,
          {
            followUpRequired: workLogData.followUpRequired,
          },
        );
        if (workLogData.followUpRequired) {
          await this.log(tx, currentUser, 'FOLLOW_UP_REQUIRED', existing, {
            followUpNotes: workLogData.followUpNotes,
          });
        }
        if (
          status === 'COMPLETED' &&
          !this.hasCompletionSignature(existing) &&
          completion.signatureSkipReason &&
          SIGNATURE_SKIP_ROLES.includes(currentUser.role as never)
        ) {
          await this.upsertSkippedSignature(
            tx,
            currentUser,
            existing,
            completion.signatureSkipReason,
            now,
          );
        }
      }
      const appointment = await tx.appointment.update({
        where: { id },
        data,
        include: this.appointmentInclude(),
      });
      await this.log(
        tx,
        currentUser,
        this.actionForStatus(status, existing.status),
        appointment,
        {
          durations: this.executionDurations(appointment, now),
          from: existing.status,
          to: status,
        },
      );
      if (existing.status === 'SCHEDULED' && status === 'CONFIRMED') {
        await this.log(
          tx,
          currentUser,
          'JOB_TIMELINE_APPOINTMENT_CONFIRMED',
          appointment,
          {
            confirmedAt: now.toISOString(),
            confirmedByUserId: currentUser.id,
            from: existing.status,
            to: status,
          },
        );
      }
      await this.syncJobProgress(tx, currentUser, existing, status);
      if (status === 'CANCELLED') {
        await this.communications.appointmentCancelled(
          tx,
          currentUser,
          appointment,
        );
      }
      if (status === 'COMPLETED') {
        await this.communications.appointmentCompleted(
          tx,
          currentUser,
          appointment,
        );
      }
      return appointment;
    });

    const appointment = this.toAppointment(updated);
    if (status === 'CANCELLED') {
      await this.notifications.notifyCancelled({
        actor: currentUser,
        appointment,
      });
    }
    if (status === 'COMPLETED') {
      await this.notifications.notifyCompleted({
        actor: currentUser,
        appointment,
      });
    }

    return { appointment };
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

  private appointmentDuration(appointment: {
    estimatedDurationMinutes: number | null;
    scheduledEnd: Date;
    scheduledStart: Date;
  }) {
    return (
      appointment.estimatedDurationMinutes ??
      Math.max(
        0,
        Math.round(
          (appointment.scheduledEnd.getTime() -
            appointment.scheduledStart.getTime()) /
            60000,
        ),
      )
    );
  }

  private dispatcherStatus(
    appointments: AppointmentWithRelations[],
    now: Date,
  ): DispatcherTechnicianStatus {
    const active = appointments.find(
      (appointment) =>
        appointment.scheduledStart <= now &&
        appointment.scheduledEnd >= now &&
        !CLOSED_STATUSES.includes(appointment.status as never),
    );
    if (active?.status === 'ON_THE_WAY') return 'TRAVELLING';
    if (active?.status === 'PAUSED') return 'ON_BREAK';
    if (active) return 'WORKING';
    const upcoming = appointments.some(
      (appointment) =>
        appointment.scheduledStart > now &&
        !CLOSED_STATUSES.includes(appointment.status as never),
    );
    if (upcoming) return 'AVAILABLE';
    if (
      appointments.length > 0 &&
      appointments.every((appointment) =>
        CLOSED_STATUSES.includes(appointment.status as never),
      )
    ) {
      return 'FINISHED_TODAY';
    }
    return 'AVAILABLE';
  }

  private initials(firstName: string, lastName: string) {
    return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase() || 'TO';
  }

  private matchesDispatcherFilters(
    technician: {
      appointments: Array<{ appointment: Appointment }>;
      completedToday: number;
      currentStatus: DispatcherTechnicianStatus;
      name: string;
      role: string;
    },
    search: string,
    filter?: DispatcherFilter,
  ) {
    if (
      search &&
      !technician.name.toLowerCase().includes(search) &&
      !technician.appointments.some((item) =>
        this.matchesAppointmentSearch(item.appointment, search),
      )
    ) {
      return false;
    }

    if (!filter) return true;
    if (filter === 'working') {
      return ['WORKING', 'TRAVELLING', 'ON_BREAK'].includes(
        technician.currentStatus,
      );
    }
    if (filter === 'available') {
      return technician.currentStatus === 'AVAILABLE';
    }
    if (filter === 'completed') {
      return technician.completedToday > 0;
    }
    if (filter === 'high-priority') {
      return technician.appointments.some(
        (item) => item.appointment.job.priority === 'HIGH',
      );
    }
    if (filter === 'overdue') {
      const now = new Date();
      return technician.appointments.some(
        (item) =>
          new Date(item.appointment.scheduledEnd) < now &&
          !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(
            item.appointment.status,
          ),
      );
    }
    return true;
  }

  private matchesAppointmentSearch(appointment: Appointment, search: string) {
    if (!search) return true;
    const customer = appointment.job.customer;
    return [
      appointment.appointmentNumber,
      appointment.job.title,
      appointment.job.jobNumber,
      customer.companyName,
      customer.displayName,
      appointment.suburb,
      appointment.status,
      appointment.job.priority,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
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
    const business = await this.prisma.business.findUnique({
      where: { id: currentUser.businessId },
      select: { timezone: true },
    });
    const timezone = business?.timezone;

    if (
      !this.isInsideWorkingHours(
        input.scheduledStart,
        input.scheduledEnd,
        timezone,
      )
    ) {
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

  private isInsideWorkingHours(start: Date, end: Date, timezone?: string) {
    const startParts = getBusinessDateParts(start, timezone);
    const endParts = getBusinessDateParts(end, timezone);
    const startMinutes = startParts.hour * 60 + startParts.minute;
    const endMinutes = endParts.hour * 60 + endParts.minute;

    return (
      start < end &&
      startMinutes >= 7 * 60 &&
      endMinutes <= 18 * 60 &&
      startParts.year === endParts.year &&
      startParts.month === endParts.month &&
      startParts.day === endParts.day
    );
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

  private assertNewAppointmentIsNotInPast(start: Date, now = new Date()) {
    if (start.getTime() < now.getTime() - APPOINTMENT_CREATION_CLOCK_SKEW_MS) {
      throw this.domainError(
        'APPOINTMENT_START_IN_PAST',
        'Appointment start time must be in the future.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private isExpiredUnstartedAppointment(
    appointment: Pick<Appointment, 'scheduledEnd' | 'status'>,
    now = new Date(),
  ) {
    return (
      ['SCHEDULED', 'CONFIRMED'].includes(appointment.status) &&
      new Date(appointment.scheduledEnd).getTime() < now.getTime()
    );
  }

  private assertTransitionWindow(
    appointment: AppointmentWithRelations,
    nextStatus: AppointmentStatus,
    now = new Date(),
  ) {
    const action = this.transitionActionForStatus(
      appointment.status,
      nextStatus,
    );
    const scheduledEnd = appointment.scheduledEnd.getTime();

    if (action === 'confirm' && now.getTime() > scheduledEnd) {
      throw this.domainError(
        'APPOINTMENT_CONFIRMATION_WINDOW_EXPIRED',
        'This appointment has already passed. Reschedule it before confirming.',
        HttpStatus.CONFLICT,
      );
    }

    if (
      ['start-travel', 'arrive', 'start'].includes(action ?? '') &&
      !this.hasStartedExecution(appointment) &&
      now.getTime() > scheduledEnd + APPOINTMENT_EXECUTION_GRACE_MS
    ) {
      throw this.domainError(
        'APPOINTMENT_EXECUTION_WINDOW_EXPIRED',
        'This appointment is too far past its scheduled time to start. Reschedule it before beginning work.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private hasStartedExecution(appointment: AppointmentWithRelations) {
    return Boolean(
      appointment.travelStartedAt ||
      appointment.arrivedAt ||
      appointment.workStartedAt ||
      appointment.currentWorkStartedAt ||
      appointment.actualStart,
    );
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

  private assertAllowedTransition(
    currentUser: AuthenticatedUser,
    appointment: AppointmentWithRelations,
    nextStatus: AppointmentStatus,
  ) {
    if (appointment.status === nextStatus) return;
    const action = this.transitionActionForStatus(
      appointment.status,
      nextStatus,
    );
    const allowed = getAllowedAppointmentTransitions({
      currentStatus: appointment.status,
      isAssignedTechnician: appointment.assignedUserId === currentUser.id,
      userRole: currentUser.role,
    });
    if (!action || !allowed.some((option) => option.action === action)) {
      throw this.domainError(
        appointment.status === 'COMPLETED'
          ? 'APPOINTMENT_ALREADY_COMPLETED'
          : 'INVALID_STATUS_TRANSITION',
        'That appointment status change is not available from the current state.',
        HttpStatus.CONFLICT,
        {
          from: appointment.status,
          to: nextStatus,
        },
      );
    }
  }

  private transitionActionForStatus(
    currentStatus: AppointmentStatus,
    nextStatus: AppointmentStatus,
  ) {
    if (currentStatus === 'SCHEDULED' && nextStatus === 'CONFIRMED') {
      return 'confirm';
    }
    if (currentStatus === 'CONFIRMED' && nextStatus === 'ON_THE_WAY') {
      return 'start-travel';
    }
    if (currentStatus === 'ON_THE_WAY' && nextStatus === 'ARRIVED') {
      return 'arrive';
    }
    if (
      ['CONFIRMED', 'ARRIVED'].includes(currentStatus) &&
      nextStatus === 'IN_PROGRESS'
    ) {
      return 'start';
    }
    if (currentStatus === 'IN_PROGRESS' && nextStatus === 'COMPLETED') {
      return 'complete';
    }
    if (currentStatus === 'IN_PROGRESS' && nextStatus === 'PAUSED') {
      return 'pause';
    }
    if (currentStatus === 'PAUSED' && nextStatus === 'IN_PROGRESS') {
      return 'resume';
    }
    if (!NON_ACTIONABLE_STATUSES.includes(currentStatus as never)) {
      if (nextStatus === 'CANCELLED') return 'cancel';
    }
    return null;
  }

  private applyExecutionTiming(
    data: Prisma.AppointmentUncheckedUpdateInput,
    appointment: AppointmentWithRelations,
    nextStatus: AppointmentStatus,
    now: Date,
  ) {
    if (nextStatus === 'ON_THE_WAY') {
      data.travelStartedAt = appointment.travelStartedAt ?? now;
    }
    if (nextStatus === 'ARRIVED') {
      data.arrivedAt = appointment.arrivedAt ?? now;
      if (appointment.travelStartedAt && appointment.totalTravelMinutes === 0) {
        data.totalTravelMinutes = this.minutesBetween(
          appointment.travelStartedAt,
          now,
        );
      }
    }
    if (nextStatus === 'IN_PROGRESS') {
      data.actualStart = appointment.actualStart ?? now;
      data.workStartedAt = appointment.workStartedAt ?? now;
      data.currentWorkStartedAt = now;
      if (appointment.status === 'PAUSED' && appointment.pausedAt) {
        data.totalPausedMinutes =
          appointment.totalPausedMinutes +
          this.minutesBetween(appointment.pausedAt, now);
        data.pausedAt = null;
      }
    }
    if (nextStatus === 'PAUSED') {
      const segmentStart =
        appointment.currentWorkStartedAt ?? appointment.workStartedAt ?? now;
      data.totalWorkMinutes =
        appointment.totalWorkMinutes + this.minutesBetween(segmentStart, now);
      data.currentWorkStartedAt = null;
      data.pausedAt = now;
    }
    if (nextStatus === 'COMPLETED') {
      data.actualEnd = now;
      data.completedAt = appointment.completedAt ?? now;
      data.currentWorkStartedAt = null;
      if (appointment.status === 'IN_PROGRESS') {
        const segmentStart =
          appointment.currentWorkStartedAt ?? appointment.workStartedAt ?? now;
        data.totalWorkMinutes =
          appointment.totalWorkMinutes + this.minutesBetween(segmentStart, now);
      }
      if (appointment.status === 'PAUSED' && appointment.pausedAt) {
        data.totalPausedMinutes =
          appointment.totalPausedMinutes +
          this.minutesBetween(appointment.pausedAt, now);
        data.pausedAt = null;
      }
    }
    if (nextStatus === 'CANCELLED') {
      data.actualEnd = now;
    }
  }

  private minutesBetween(start: Date, end: Date) {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  private executionDurations(
    appointment: Pick<
      AppointmentWithRelations,
      | 'arrivedAt'
      | 'completedAt'
      | 'currentWorkStartedAt'
      | 'pausedAt'
      | 'scheduledStart'
      | 'status'
      | 'totalPausedMinutes'
      | 'totalTravelMinutes'
      | 'totalWorkMinutes'
      | 'travelStartedAt'
      | 'workStartedAt'
    >,
    now = new Date(),
  ): AppointmentExecutionDurations {
    const travelMinutes =
      appointment.status === 'ON_THE_WAY' && appointment.travelStartedAt
        ? this.minutesBetween(appointment.travelStartedAt, now)
        : appointment.totalTravelMinutes;
    const workSegmentStart =
      appointment.currentWorkStartedAt ?? appointment.workStartedAt;
    const workMinutes =
      appointment.status === 'IN_PROGRESS' && workSegmentStart
        ? appointment.totalWorkMinutes +
          this.minutesBetween(workSegmentStart, now)
        : appointment.totalWorkMinutes;
    const pausedMinutes =
      appointment.status === 'PAUSED' && appointment.pausedAt
        ? appointment.totalPausedMinutes +
          this.minutesBetween(appointment.pausedAt, now)
        : appointment.totalPausedMinutes;
    const elapsedStart =
      appointment.travelStartedAt ?? appointment.workStartedAt;
    const elapsedEnd = appointment.completedAt ?? now;

    return {
      calculatedAt: now.toISOString(),
      pausedMinutes,
      totalElapsedMinutes: elapsedStart
        ? this.minutesBetween(elapsedStart, elapsedEnd)
        : 0,
      travelMinutes,
      workMinutes,
    };
  }

  private hasSignatureStrokes(
    signatureData: CaptureAppointmentSignatureDto['signatureData'],
  ) {
    return (
      Array.isArray(signatureData?.strokes) &&
      signatureData.strokes.some(
        (stroke) => Array.isArray(stroke) && stroke.length > 0,
      )
    );
  }

  private hasCompletionSignature(appointment: AppointmentWithRelations) {
    const signature = appointment.signatures?.[0];
    return Boolean(
      signature &&
      ((signature.capturedAt && signature.signatureData) ||
        (signature.skippedAt && signature.skipReason)),
    );
  }

  private assertCompletionSignatureRequirement(
    currentUser: AuthenticatedUser,
    appointment: AppointmentWithRelations,
    completion?: CompleteAppointmentPayload,
  ) {
    const signature = appointment.signatures?.[0];
    if (completion?.signatureId && signature?.id !== completion.signatureId) {
      throw this.domainError(
        'SIGNATURE_NOT_FOUND',
        'The saved signature could not be matched to this appointment.',
        HttpStatus.CONFLICT,
      );
    }
    if (this.hasCompletionSignature(appointment)) return;
    if (
      completion?.signatureSkipReason &&
      SIGNATURE_SKIP_ROLES.includes(currentUser.role as never)
    ) {
      return;
    }
    throw this.domainError(
      'SIGNATURE_REQUIRED',
      'Capture the customer signature before completing this appointment.',
      HttpStatus.CONFLICT,
    );
  }

  private async upsertSkippedSignature(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    appointment: AppointmentWithRelations,
    rawReason: string,
    skippedAt: Date,
  ) {
    const reason = this.clean(rawReason);
    if (!reason) {
      throw this.domainError(
        'SIGNATURE_SKIP_REASON_REQUIRED',
        'Add a reason before skipping the customer signature.',
      );
    }
    await tx.appointmentSignature.upsert({
      create: {
        appointmentId: appointment.id,
        businessId: currentUser.businessId,
        capturedByUserId: currentUser.id,
        consentText: SIGNATURE_CONSENT_TEXT,
        jobId: appointment.jobId,
        skipReason: reason,
        skippedAt,
      },
      update: {
        capturedAt: null,
        capturedByUserId: currentUser.id,
        customerName: null,
        signatureData: {},
        signerTitle: null,
        skipReason: reason,
        skippedAt,
      },
      where: {
        businessId_appointmentId: {
          appointmentId: appointment.id,
          businessId: currentUser.businessId,
        },
      },
    });
    await this.log(
      tx,
      currentUser,
      'APPOINTMENT_SIGNATURE_SKIPPED',
      appointment,
      {
        reason,
        skippedAt: skippedAt.toISOString(),
      },
    );
  }

  private assertValidFieldWork(
    dto: AppointmentWorkLogDto | CompleteAppointmentPayload | undefined,
  ) {
    const errors = validateAppointmentFieldWork({
      followUpNotes: dto?.followUpNotes,
      followUpRequired: dto?.followUpRequired,
    });
    if (errors.followUpNotes) {
      throw this.domainError(
        'FOLLOW_UP_NOTES_REQUIRED',
        errors.followUpNotes,
        HttpStatus.BAD_REQUEST,
        { field: 'followUpNotes' },
      );
    }
  }

  private assertValidCompletion(
    currentUser: AuthenticatedUser,
    appointment: AppointmentWithRelations,
    completion?: CompleteAppointmentPayload,
  ) {
    const errors = validateAppointmentCompletion({
      canSkipSignature: SIGNATURE_SKIP_ROLES.includes(
        currentUser.role as never,
      ),
      followUpNotes: completion?.followUpNotes,
      followUpRequired: completion?.followUpRequired,
      hasSignature: this.hasCompletionSignature(appointment),
      signatureSkipReason: completion?.signatureSkipReason,
      workCompleted: completion?.workCompleted,
    });
    if (errors.workCompleted) {
      throw this.domainError(
        'WORK_COMPLETED_REQUIRED',
        errors.workCompleted,
        HttpStatus.BAD_REQUEST,
        { field: 'workCompleted' },
      );
    }
    if (errors.followUpNotes) {
      throw this.domainError(
        'FOLLOW_UP_NOTES_REQUIRED',
        errors.followUpNotes,
        HttpStatus.BAD_REQUEST,
        { field: 'followUpNotes' },
      );
    }
    if (
      errors.signatureSkipReason &&
      completion?.signatureSkipReason !== undefined
    ) {
      throw this.domainError(
        'SIGNATURE_SKIP_REASON_REQUIRED',
        errors.signatureSkipReason,
        HttpStatus.BAD_REQUEST,
        { field: 'signatureSkipReason' },
      );
    }
    if (hasAppointmentValidationErrors(errors) && errors.signature) {
      throw this.domainError(
        'SIGNATURE_REQUIRED',
        errors.signature,
        HttpStatus.CONFLICT,
        { field: 'signature' },
      );
    }
  }

  private workLogData(
    currentUser: AuthenticatedUser,
    appointment: Pick<AppointmentWithRelations, 'id' | 'businessId' | 'jobId'>,
    dto: AppointmentWorkLogDto | CompleteAppointmentPayload,
  ): Prisma.AppointmentWorkLogUncheckedCreateInput {
    const followUpRequired = Boolean(dto.followUpRequired);
    return {
      appointmentId: appointment.id,
      businessId: appointment.businessId,
      followUpNotes: followUpRequired ? this.clean(dto.followUpNotes) : null,
      followUpRequired,
      jobId: appointment.jobId,
      technicianNotes: this.clean(dto.technicianNotes),
      technicianUserId: currentUser.id,
      workCompleted: this.clean(dto.workCompleted),
    };
  }

  private async syncJobProgress(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    appointment: AppointmentWithRelations,
    nextStatus: AppointmentStatus,
  ) {
    if (!['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(nextStatus)) return;
    const job = await tx.job.findFirst({
      where: { businessId: currentUser.businessId, id: appointment.jobId },
      select: { actualStart: true, status: true },
    });
    if (!job || ['CANCELLED', 'COMPLETED'].includes(job.status)) return;
    if (job.status === 'IN_PROGRESS') return;

    const now = new Date();
    await tx.job.update({
      where: { id: appointment.jobId },
      data: {
        actualStart: job.actualStart ?? now,
        status: 'IN_PROGRESS',
        updatedBy: currentUser.id,
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'JOB_STARTED_FROM_APPOINTMENT',
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: appointment.jobId,
        entityType: 'Job',
        metadata: {
          appointmentId: appointment.id,
          appointmentStatus: nextStatus,
        },
      },
    });
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
      include: { customer: { include: { communicationPreference: true } } },
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
        role: { in: [...APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES] },
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
    const [business, existing] = await Promise.all([
      tx.business.findUnique({
        where: { id: businessId },
        select: { timezone: true },
      }),
      tx.appointmentSequence.findUnique({
        where: { businessId },
      }),
    ]);
    const year = getBusinessDateParts(scheduledStart, business?.timezone).year;
    const prefix = `APT-${year}-`;
    const latestAppointment = await tx.appointment.findFirst({
      where: {
        appointmentNumber: { startsWith: prefix },
        businessId,
      },
      orderBy: { appointmentNumber: 'desc' },
      select: { appointmentNumber: true },
    });
    const latestNumber = this.sequenceNumberFromSuffix(
      latestAppointment?.appointmentNumber,
      prefix,
    );
    const nextNumber = Math.max(existing?.nextNumber ?? 1, latestNumber + 1);
    const nextSequenceNumber = nextNumber + 1;
    if (existing) {
      await tx.appointmentSequence.update({
        where: { businessId },
        data: { nextNumber: nextSequenceNumber },
      });
    } else {
      await tx.appointmentSequence.create({
        data: { businessId, nextNumber: nextSequenceNumber },
      });
    }
    return `APT-${year}-${String(nextNumber).padStart(6, '0')}`;
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

  private actionForStatus(
    status: AppointmentStatus,
    previousStatus?: AppointmentStatus,
  ) {
    if (status === 'IN_PROGRESS' && previousStatus === 'PAUSED') {
      return 'APPOINTMENT_RESUMED';
    }
    if (status === 'IN_PROGRESS') return 'APPOINTMENT_WORK_STARTED';
    if (status === 'PAUSED') return 'APPOINTMENT_PAUSED';
    if (status === 'ARRIVED') return 'APPOINTMENT_ARRIVED';
    if (status === 'CONFIRMED') return 'APPOINTMENT_CONFIRMED';
    if (status === 'COMPLETED') return 'APPOINTMENT_COMPLETED';
    if (status === 'CANCELLED') return 'APPOINTMENT_CANCELLED';
    if (status === 'ON_THE_WAY') return 'APPOINTMENT_TRAVEL_STARTED';
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
              communicationPreference: {
                select: {
                  emailEnabled: true,
                  smsEnabled: true,
                },
              },
              displayName: true,
              email: true,
              id: true,
              phone: true,
            },
          },
          customerId: true,
          id: true,
          jobNumber: true,
          postcode: true,
          priority: true,
          state: true,
          suburb: true,
          title: true,
        },
      },
      workLogs: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
      signatures: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    } satisfies Prisma.AppointmentInclude;
  }

  private toAppointment(appointment: AppointmentWithRelations): Appointment {
    const signature = appointment.signatures?.[0] ?? null;
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
      createdAt: appointment.createdAt.toISOString(),
      createdBy: appointment.createdBy,
      customerSiteId: appointment.customerSiteId,
      completedAt: appointment.completedAt?.toISOString() ?? null,
      estimatedDurationMinutes: appointment.estimatedDurationMinutes,
      currentWorkStartedAt:
        appointment.currentWorkStartedAt?.toISOString() ?? null,
      executionDurations: this.executionDurations(appointment),
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
      signature: signature ? this.toSignature(signature) : null,
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
      workLog: appointment.workLogs?.[0]
        ? {
            appointmentId: appointment.workLogs[0].appointmentId,
            businessId: appointment.workLogs[0].businessId,
            createdAt: appointment.workLogs[0].createdAt.toISOString(),
            followUpNotes: appointment.workLogs[0].followUpNotes,
            followUpRequired: appointment.workLogs[0].followUpRequired,
            id: appointment.workLogs[0].id,
            jobId: appointment.workLogs[0].jobId,
            technicianNotes: appointment.workLogs[0].technicianNotes,
            technicianUserId: appointment.workLogs[0].technicianUserId,
            updatedAt: appointment.workLogs[0].updatedAt.toISOString(),
            workCompleted: appointment.workLogs[0].workCompleted,
          }
        : null,
    };
  }

  private toSignature(
    signature: NonNullable<AppointmentWithRelations['signatures']>[number],
  ): AppointmentSignature {
    return {
      appointmentId: signature.appointmentId,
      businessId: signature.businessId,
      capturedAt: signature.capturedAt?.toISOString() ?? null,
      capturedByUserId: signature.capturedByUserId,
      consentText: signature.consentText,
      createdAt: signature.createdAt.toISOString(),
      customerName: signature.customerName,
      id: signature.id,
      jobId: signature.jobId,
      signatureData:
        signature.signatureData &&
        typeof signature.signatureData === 'object' &&
        !Array.isArray(signature.signatureData)
          ? (signature.signatureData as unknown as AppointmentSignature['signatureData'])
          : null,
      signerTitle: signature.signerTitle,
      skippedAt: signature.skippedAt?.toISOString() ?? null,
      skipReason: signature.skipReason,
      updatedAt: signature.updatedAt.toISOString(),
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
