import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import {
  DEFAULT_BUSINESS_END_TIME,
  DEFAULT_BUSINESS_START_TIME,
  formatBusinessClockTime,
  formatBusinessOperatingHours,
  isOvernightBusinessHours,
  isTimeWithinBusinessHours,
  validateBusinessOperatingHours,
} from '@tradieos/shared';
import { BusinessesService } from './businesses.service';

describe('business operating hours', () => {
  const owner: AuthenticatedUser = {
    businessId: 'business-1',
    email: 'owner@example.com',
    firstName: 'Owner',
    id: 'user-1',
    lastName: 'User',
    role: 'OWNER',
  };

  it('defaults existing businesses to standard daytime operating hours', async () => {
    const service = new BusinessesService(
      prismaWithBusiness({
        businessEndTime: null,
        businessStartTime: null,
      }),
    );

    await expect(service.operatingHours(owner)).resolves.toEqual({
      operatingHours: {
        businessEndTime: DEFAULT_BUSINESS_END_TIME,
        businessStartTime: DEFAULT_BUSINESS_START_TIME,
      },
    });
  });

  it('persists valid daytime operating hours from business settings', async () => {
    const update = jest.fn().mockResolvedValue({
      businessEndTime: '17:00',
      businessStartTime: '08:00',
    });
    const service = new BusinessesService(prismaWithBusiness({}, update));

    await expect(
      service.updateOperatingHours(owner, {
        businessEndTime: '17:00',
        businessStartTime: '08:00',
      }),
    ).resolves.toEqual({
      operatingHours: {
        businessEndTime: '17:00',
        businessStartTime: '08:00',
      },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          businessEndTime: '17:00',
          businessStartTime: '08:00',
        },
      }),
    );
  });

  it('allows long daytime windows and near all-day windows', () => {
    expect(validateBusinessOperatingHours('06:00', '22:00')).toBeNull();
    expect(validateBusinessOperatingHours('00:00', '23:59')).toBeNull();
    expect(
      formatBusinessOperatingHours({
        businessEndTime: '23:59',
        businessStartTime: '00:00',
      }),
    ).toBe('12:00 AM – 11:59 PM');
  });

  it('supports overnight operating windows across midnight', () => {
    expect(validateBusinessOperatingHours('22:00', '06:00')).toBeNull();
    expect(isOvernightBusinessHours('22:00', '06:00')).toBe(true);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '06:00',
        businessStartTime: '22:00',
        time: '23:00',
      }),
    ).toBe(true);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '06:00',
        businessStartTime: '22:00',
        time: '02:00',
      }),
    ).toBe(true);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '06:00',
        businessStartTime: '22:00',
        time: '05:30',
      }),
    ).toBe(true);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '06:00',
        businessStartTime: '22:00',
        time: '12:00',
      }),
    ).toBe(false);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '06:00',
        businessStartTime: '22:00',
        time: '18:00',
      }),
    ).toBe(false);
  });

  it('uses inclusive start and exclusive end boundaries', () => {
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '17:00',
        businessStartTime: '08:00',
        time: '08:00',
      }),
    ).toBe(true);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '17:00',
        businessStartTime: '08:00',
        time: '16:59',
      }),
    ).toBe(true);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '17:00',
        businessStartTime: '08:00',
        time: '17:00',
      }),
    ).toBe(false);
    expect(
      isTimeWithinBusinessHours({
        businessEndTime: '17:00',
        businessStartTime: '08:00',
        time: '17:01',
      }),
    ).toBe(false);
  });

  it.each(['24:00', '12:60', 'abc', ''])(
    'rejects invalid clock time %s',
    (value) => {
      expect(validateBusinessOperatingHours(value, '17:00')).not.toBeNull();
    },
  );

  it('rejects identical start and end times', async () => {
    const service = new BusinessesService(prismaWithBusiness());

    await expect(
      service.updateOperatingHours(owner, {
        businessEndTime: '08:00',
        businessStartTime: '08:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps business settings restricted to existing owner/admin/office roles', async () => {
    const service = new BusinessesService(prismaWithBusiness());

    await expect(
      service.operatingHours({ ...owner, role: 'TECHNICIAN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('formats canonical clock times for customer-friendly display', () => {
    expect(formatBusinessClockTime('00:00')).toBe('12:00 AM');
    expect(formatBusinessClockTime('08:30')).toBe('8:30 AM');
    expect(formatBusinessClockTime('13:00')).toBe('1:00 PM');
    expect(formatBusinessClockTime('23:59')).toBe('11:59 PM');
  });
});

function prismaWithBusiness(
  business: {
    businessEndTime?: string | null;
    businessStartTime?: string | null;
  } = {},
  update = jest.fn(),
) {
  const findUnique = jest.fn().mockResolvedValue({
    businessEndTime: DEFAULT_BUSINESS_END_TIME,
    businessStartTime: DEFAULT_BUSINESS_START_TIME,
    ...business,
  });

  return {
    business: {
      findUnique,
      update,
    },
  } as never;
}
