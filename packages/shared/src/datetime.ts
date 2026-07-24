export const AUSTRALIAN_TIMEZONES = [
  'Australia/Melbourne',
  'Australia/Sydney',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Perth',
  'Australia/Hobart',
  'Australia/Darwin',
] as const;

export type AustralianTimezone = (typeof AUSTRALIAN_TIMEZONES)[number];

const STATE_TIMEZONE: Record<string, AustralianTimezone> = {
  ACT: 'Australia/Sydney',
  NSW: 'Australia/Sydney',
  NT: 'Australia/Darwin',
  QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide',
  TAS: 'Australia/Hobart',
  VIC: 'Australia/Melbourne',
  WA: 'Australia/Perth',
};

const DEFAULT_TIMEZONE: AustralianTimezone = 'Australia/Sydney';

export function timezoneForAustralianState(
  state?: string | null,
): AustralianTimezone {
  if (!state) return DEFAULT_TIMEZONE;
  return STATE_TIMEZONE[state.trim().toUpperCase()] ?? DEFAULT_TIMEZONE;
}

export function normaliseBusinessTimezone(
  timezone?: string | null,
): AustralianTimezone {
  return AUSTRALIAN_TIMEZONES.includes(timezone as AustralianTimezone)
    ? (timezone as AustralianTimezone)
    : DEFAULT_TIMEZONE;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

export function formatBusinessDate(
  value: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: normaliseBusinessTimezone(timezone),
    year: 'numeric',
  }).format(toDate(value));
}

export function formatBusinessLongDate(
  value: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    timeZone: normaliseBusinessTimezone(timezone),
    weekday: 'short',
    year: 'numeric',
  }).format(toDate(value));
}

export function formatBusinessTime(
  value: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: normaliseBusinessTimezone(timezone),
  })
    .format(toDate(value))
    .toLowerCase();
}

export function formatBusinessTimeRange(
  start: Date | string,
  end: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  return `${formatBusinessTime(start, timezone)} – ${formatBusinessTime(
    end,
    timezone,
  )}`;
}

export function formatBusinessDateTime(
  value: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  return `${formatBusinessDate(value, timezone)} at ${formatBusinessTime(
    value,
    timezone,
  )}`;
}

export function formatBusinessTimezoneAbbreviation(
  value: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: normaliseBusinessTimezone(timezone),
    timeZoneName: 'short',
  }).formatToParts(toDate(value));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

export function getBusinessDateParts(
  value: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: normaliseBusinessTimezone(timezone),
    year: 'numeric',
  }).formatToParts(toDate(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    month: Number(map.month),
    second: Number(map.second),
    year: Number(map.year),
  };
}

function timezoneOffsetMilliseconds(value: Date, timezone: AustralianTimezone) {
  const parts = getBusinessDateParts(value, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - value.getTime();
}

export function zonedTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timezone: string = DEFAULT_TIMEZONE,
) {
  const normalisedTimezone = normaliseBusinessTimezone(timezone);
  const utcGuess = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour ?? 0,
      parts.minute ?? 0,
      parts.second ?? 0,
    ),
  );
  const firstPass = new Date(
    utcGuess.getTime() -
      timezoneOffsetMilliseconds(utcGuess, normalisedTimezone),
  );
  return new Date(
    utcGuess.getTime() -
      timezoneOffsetMilliseconds(firstPass, normalisedTimezone),
  );
}

export function getBusinessDayRangeUtc(
  value: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  const parts = getBusinessDateParts(value, timezone);
  const start = zonedTimeToUtc(
    {
      day: parts.day,
      month: parts.month,
      year: parts.year,
    },
    timezone,
  );
  const end = zonedTimeToUtc(
    {
      day: parts.day + 1,
      month: parts.month,
      year: parts.year,
    },
    timezone,
  );
  return { end, start };
}
