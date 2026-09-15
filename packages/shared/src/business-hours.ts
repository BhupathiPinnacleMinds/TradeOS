export const DEFAULT_BUSINESS_START_TIME = '08:00';
export const DEFAULT_BUSINESS_END_TIME = '17:00';

const BUSINESS_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface BusinessOperatingHours {
  businessStartTime: string;
  businessEndTime: string;
}

export interface BusinessOperatingHoursPayload {
  businessStartTime: string;
  businessEndTime: string;
}

export interface BusinessOperatingHoursResponse {
  operatingHours: BusinessOperatingHours;
}

export function isValidBusinessClockTime(value?: string | null): boolean {
  return BUSINESS_CLOCK_TIME_PATTERN.test(value?.trim() ?? '');
}

export function normaliseBusinessClockTime(value: string): string {
  const trimmed = value.trim();
  if (!isValidBusinessClockTime(trimmed)) {
    throw new Error('Business hours must use HH:mm format.');
  }
  return trimmed;
}

export function validateBusinessOperatingHours(
  businessStartTime?: string | null,
  businessEndTime?: string | null,
): string | null {
  if (!isValidBusinessClockTime(businessStartTime)) {
    return 'Business start time must use HH:mm format.';
  }

  if (!isValidBusinessClockTime(businessEndTime)) {
    return 'Business end time must use HH:mm format.';
  }

  if (businessStartTime?.trim() === businessEndTime?.trim()) {
    return 'Business start and end times must be different.';
  }

  return null;
}

export function isOvernightBusinessHours(
  businessStartTime: string,
  businessEndTime: string,
): boolean {
  return (
    businessClockMinutes(businessStartTime) >
    businessClockMinutes(businessEndTime)
  );
}

export function formatBusinessClockTime(value: string): string {
  const minutes = businessClockMinutes(value);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function formatBusinessOperatingHours({
  businessStartTime,
  businessEndTime,
}: BusinessOperatingHours): string {
  return `${formatBusinessClockTime(
    businessStartTime,
  )} – ${formatBusinessClockTime(businessEndTime)}`;
}

export function isTimeWithinBusinessHours({
  businessEndTime,
  businessStartTime,
  time,
}: {
  businessStartTime: string;
  businessEndTime: string;
  time: string;
}): boolean {
  const start = businessClockMinutes(businessStartTime);
  const end = businessClockMinutes(businessEndTime);
  const target = businessClockMinutes(time);

  if (start === end) return false;
  if (start < end) return target >= start && target < end;
  return target >= start || target < end;
}

export function businessClockTimeToMinutes(value: string): number {
  const match = BUSINESS_CLOCK_TIME_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error('Business clock time must use HH:mm format.');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function businessClockMinutes(value: string): number {
  return businessClockTimeToMinutes(value);
}
