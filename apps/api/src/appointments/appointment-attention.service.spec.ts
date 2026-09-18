import type { Appointment } from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentAttentionService } from './appointment-attention.service';

describe('AppointmentAttentionService', () => {
  const prisma = {
    appointment: { findMany: jest.fn() },
    business: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ timezone: 'Australia/Melbourne' }),
    },
    memberLeave: { findMany: jest.fn() },
  };
  const service = new AppointmentAttentionService(
    prisma as unknown as PrismaService,
  );
  const appointment = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'appointment-1',
      businessId: 'business-1',
      status: 'SCHEDULED',
      scheduledStart: '2026-09-21T23:30:00.000Z',
      scheduledEnd: '2026-09-22T01:30:00.000Z',
      assignedUserId: 'tech-1',
      assignedUser: { id: 'tech-1', firstName: 'Ganga', lastName: 'G' },
      technicians: [
        { id: 'tech-1', firstName: 'Ganga', lastName: 'G' },
        { id: 'tech-2', firstName: 'Ram', lastName: 'G' },
      ],
      ...overrides,
    }) as unknown as Appointment;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.memberLeave.findMany.mockResolvedValue([]);
  });

  it('flags only the unavailable crew member without changing appointment status', async () => {
    prisma.memberLeave.findMany.mockResolvedValue([
      {
        startDate: '2026-09-22',
        endDate: '2026-09-22',
        type: 'SICK_LEAVE',
        member: { userId: 'tech-1' },
      },
    ]);
    const [result] = await service.decorate('business-1', [appointment()]);
    expect(result.status).toBe('SCHEDULED');
    expect(result.technicians).toHaveLength(2);
    expect(result.availabilityConflict?.technicians).toEqual([
      expect.objectContaining({ id: 'tech-1', leaveType: 'SICK_LEAVE' }),
    ]);
    const leaveCalls = prisma.memberLeave.findMany.mock
      .calls as unknown as Array<[{ where: { businessId: string } }]>;
    const leaveQuery = leaveCalls[0]?.[0];
    expect(leaveQuery.where.businessId).toBe('business-1');
  });

  it('clears attention when leave is cancelled, moved, appointment rescheduled or terminal', async () => {
    const leave = {
      startDate: '2026-09-22',
      endDate: '2026-09-22',
      type: 'SICK_LEAVE',
      member: { userId: 'tech-1' },
    };
    prisma.memberLeave.findMany.mockResolvedValue([leave]);
    expect(
      (await service.decorate('business-1', [appointment()]))[0]
        .availabilityConflict,
    ).not.toBeNull();
    prisma.memberLeave.findMany.mockResolvedValue([]);
    expect(
      (await service.decorate('business-1', [appointment()]))[0]
        .availabilityConflict,
    ).toBeNull();
    prisma.memberLeave.findMany.mockResolvedValue([leave]);
    expect(
      (
        await service.decorate('business-1', [
          appointment({
            scheduledStart: '2026-09-23T00:00:00Z',
            scheduledEnd: '2026-09-23T01:00:00Z',
          }),
        ])
      )[0].availabilityConflict,
    ).toBeNull();
    expect(
      (
        await service.decorate('business-1', [
          appointment({ status: 'COMPLETED' }),
        ])
      )[0].availabilityConflict,
    ).toBeNull();
  });

  it('finds all nonterminal assigned appointments for a leave without crossing tenants', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'appointment-1',
        scheduledStart: new Date('2026-09-21T23:30:00Z'),
        scheduledEnd: new Date('2026-09-22T01:30:00Z'),
        job: { title: 'Bench top' },
      },
      {
        id: 'appointment-2',
        scheduledStart: new Date('2026-09-22T00:30:00Z'),
        scheduledEnd: new Date('2026-09-22T02:00:00Z'),
        job: { title: 'Tap' },
      },
    ]);
    const affected = await service.affectedAppointmentsForLeave({
      businessId: 'business-1',
      userId: 'tech-1',
      startDate: '2026-09-22',
      endDate: '2026-09-22',
    });
    expect(affected.map(({ id }) => id)).toEqual([
      'appointment-1',
      'appointment-2',
    ]);
    const appointmentCalls = prisma.appointment.findMany.mock
      .calls as unknown as Array<
      [{ where: { businessId: string; status: { notIn: string[] } } }]
    >;
    const appointmentQuery = appointmentCalls[0]?.[0];
    expect(appointmentQuery.where.businessId).toBe('business-1');
    expect(appointmentQuery.where.status.notIn).toContain('COMPLETED');
    expect(appointmentQuery.where.status.notIn).toContain('CANCELLED');
  });
});
