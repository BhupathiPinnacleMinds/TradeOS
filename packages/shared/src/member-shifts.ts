import {
  businessClockTimeToMinutes,
  formatBusinessClockTime,
  isValidBusinessClockTime,
} from './business-hours';
import { isDateOnly, isMemberOnLeave, type MemberLeave } from './member-leave';

export const MEMBER_SHIFT_STATUSES = ['ACTIVE', 'CANCELLED'] as const;

export type MemberShiftStatus = (typeof MEMBER_SHIFT_STATUSES)[number];

export interface MemberShift {
  id: string;
  businessId: string;
  memberId: string;
  memberName?: string | null;
  memberEmail?: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string;
  status: MemberShiftStatus;
  note: string | null;
  createdByMemberId: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberShiftPayload {
  memberId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  note?: string | null;
}

export interface MemberShiftListResponse {
  records: MemberShift[];
}

export interface MemberShiftResponse {
  shift: MemberShift;
}

export interface MemberShiftQuery {
  date?: string;
  fromDate?: string;
  toDate?: string;
  memberId?: string;
}

const MINUTES_PER_DAY = 24 * 60;

export type ShiftInterval = {
  end: number;
  start: number;
};

export function validateMemberShiftPayload(
  payload: Pick<MemberShiftPayload, 'endTime' | 'shiftDate' | 'startTime'>,
): string | null {
  if (!isDateOnly(payload.shiftDate)) {
    return 'Shift date must use YYYY-MM-DD.';
  }
  if (!isValidBusinessClockTime(payload.startTime)) {
    return 'Shift start time must use HH:mm format.';
  }
  if (!isValidBusinessClockTime(payload.endTime)) {
    return 'Shift end time must use HH:mm format.';
  }
  if (payload.startTime.trim() === payload.endTime.trim()) {
    return 'Shift start and end times must be different.';
  }
  return null;
}

export function isOvernightMemberShift(
  shift: Pick<MemberShiftPayload, 'endTime' | 'startTime'>,
): boolean {
  return (
    businessClockTimeToMinutes(shift.endTime) <
    businessClockTimeToMinutes(shift.startTime)
  );
}

export function createShiftInterval(
  shift: Pick<MemberShiftPayload, 'endTime' | 'shiftDate' | 'startTime'>,
): ShiftInterval {
  const validationError = validateMemberShiftPayload(shift);
  if (validationError) throw new Error(validationError);

  const start = dateOnlyOrdinal(shift.shiftDate) * MINUTES_PER_DAY;
  const startOffset = businessClockTimeToMinutes(shift.startTime);
  const endOffset = businessClockTimeToMinutes(shift.endTime);
  const adjustedEndOffset =
    endOffset < startOffset ? endOffset + MINUTES_PER_DAY : endOffset;

  return {
    end: start + adjustedEndOffset,
    start: start + startOffset,
  };
}

export function memberShiftIntervalsOverlap(
  first: Pick<MemberShiftPayload, 'endTime' | 'shiftDate' | 'startTime'>,
  second: Pick<MemberShiftPayload, 'endTime' | 'shiftDate' | 'startTime'>,
): boolean {
  const firstInterval = createShiftInterval(first);
  const secondInterval = createShiftInterval(second);
  return (
    firstInterval.start < secondInterval.end &&
    secondInterval.start < firstInterval.end
  );
}

export function isShiftWithinBusinessHours({
  businessEndTime,
  businessStartTime,
  shift,
}: {
  businessEndTime: string;
  businessStartTime: string;
  shift: Pick<MemberShiftPayload, 'endTime' | 'shiftDate' | 'startTime'>;
}): boolean {
  if (!isValidBusinessClockTime(businessStartTime)) return false;
  if (!isValidBusinessClockTime(businessEndTime)) return false;
  if (businessStartTime.trim() === businessEndTime.trim()) return false;

  const shiftInterval = createShiftInterval(shift);
  const businessStart =
    dateOnlyOrdinal(shift.shiftDate) * MINUTES_PER_DAY +
    businessClockTimeToMinutes(businessStartTime);
  const businessEndOffset = businessClockTimeToMinutes(businessEndTime);
  const businessStartOffset = businessClockTimeToMinutes(businessStartTime);
  const businessEnd =
    businessStart +
    (businessEndOffset <= businessStartOffset
      ? businessEndOffset + MINUTES_PER_DAY - businessStartOffset
      : businessEndOffset - businessStartOffset);

  return (
    shiftInterval.start >= businessStart && shiftInterval.end <= businessEnd
  );
}

export function getMemberShiftDates(
  shift: Pick<MemberShiftPayload, 'endTime' | 'shiftDate' | 'startTime'>,
): string[] {
  const dates = [shift.shiftDate];
  if (isOvernightMemberShift(shift)) {
    dates.push(addDaysToDateOnly(shift.shiftDate, 1));
  }
  return dates;
}

export function shiftOverlapsMemberLeave(
  shift: Pick<MemberShiftPayload, 'endTime' | 'shiftDate' | 'startTime'>,
  leaves: Array<Pick<MemberLeave, 'endDate' | 'startDate' | 'status'>>,
): boolean {
  const shiftDates = getMemberShiftDates(shift);
  return leaves.some((leave) =>
    shiftDates.some((date) => isMemberOnLeave(leave, date)),
  );
}

export function formatMemberShiftTimeRange(
  shift: Pick<MemberShiftPayload, 'endTime' | 'startTime'>,
): string {
  return `${formatBusinessClockTime(shift.startTime)} – ${formatBusinessClockTime(
    shift.endTime,
  )}`;
}

export function addDaysToDateOnly(value: string, days: number): string {
  if (!isDateOnly(value)) throw new Error('Date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dateOnlyOrdinal(value: string): number {
  if (!isDateOnly(value)) throw new Error('Date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) /
      (MINUTES_PER_DAY * 60 * 1000),
  );
}
