export const MEMBER_LEAVE_TYPES = [
  'ANNUAL_LEAVE',
  'SICK_LEAVE',
  'PERSONAL_LEAVE',
  'UNAVAILABLE',
  'OTHER',
] as const;

export const MEMBER_LEAVE_STATUSES = ['ACTIVE', 'CANCELLED'] as const;

export type MemberLeaveType = (typeof MEMBER_LEAVE_TYPES)[number];
export type MemberLeaveStatus = (typeof MEMBER_LEAVE_STATUSES)[number];

export interface MemberLeave {
  id: string;
  businessId: string;
  memberId: string;
  memberName?: string | null;
  memberEmail?: string | null;
  type: MemberLeaveType;
  startDate: string;
  endDate: string;
  note: string | null;
  status: MemberLeaveStatus;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberLeavePayload {
  type: MemberLeaveType;
  startDate: string;
  endDate: string;
  note?: string | null;
}

export interface MemberLeaveListResponse {
  records: MemberLeave[];
}

export interface MemberLeaveResponse {
  leave: MemberLeave;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value?: string | null): boolean {
  if (!value) return false;
  const match = DATE_ONLY_PATTERN.exec(value.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateMemberLeaveRange(
  startDate?: string | null,
  endDate?: string | null,
): string | null {
  if (!isDateOnly(startDate)) return 'Start date must use YYYY-MM-DD.';
  if (!isDateOnly(endDate)) return 'End date must use YYYY-MM-DD.';
  if (String(endDate).trim() < String(startDate).trim()) {
    return 'End date cannot be before start date.';
  }
  return null;
}

export function memberLeaveRangesOverlap(
  first: { startDate: string; endDate: string },
  second: { startDate: string; endDate: string },
): boolean {
  return first.startDate <= second.endDate && second.startDate <= first.endDate;
}

export function isMemberOnLeave(
  leave: Pick<MemberLeave, 'endDate' | 'startDate' | 'status'>,
  date: string,
): boolean {
  return (
    leave.status === 'ACTIVE' &&
    isDateOnly(date) &&
    leave.startDate <= date &&
    date <= leave.endDate
  );
}

export function formatMemberLeaveType(type: MemberLeaveType): string {
  const labels: Record<MemberLeaveType, string> = {
    ANNUAL_LEAVE: 'Annual leave',
    OTHER: 'Other',
    PERSONAL_LEAVE: 'Personal leave',
    SICK_LEAVE: 'Sick leave',
    UNAVAILABLE: 'Unavailable',
  };
  return labels[type];
}

export function formatDateOnlyForDisplay(value: string): string {
  if (!isDateOnly(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}

export function formatMemberLeaveDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) return formatDateOnlyForDisplay(startDate);
  return `${formatDateOnlyForDisplay(startDate)} – ${formatDateOnlyForDisplay(
    endDate,
  )}`;
}
