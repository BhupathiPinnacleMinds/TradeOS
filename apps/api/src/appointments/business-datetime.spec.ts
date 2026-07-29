import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessDate,
  formatBusinessRelativeDay,
  formatBusinessTime,
  formatBusinessTimeRange,
  formatBusinessTimezoneAbbreviation,
  getBusinessDayRangeUtc,
  getBusinessGreeting,
  timezoneForAustralianState,
  zonedTimeToUtc,
} from '@tradieos/shared';

describe('business datetime utilities', () => {
  it('formats Australian dates and times using business timezone', () => {
    const value = '2026-07-16T10:00:00.000Z';

    expect(formatBusinessDate(value, 'Australia/Melbourne')).toBe('16/07/2026');
    expect(formatBusinessTime(value, 'Australia/Melbourne')).toBe('8:00 pm');
    expect(
      formatBusinessTimeRange(
        value,
        '2026-07-16T12:00:00.000Z',
        'Australia/Melbourne',
      ),
    ).toBe('8:00 pm – 10:00 pm');
  });

  it('defaults unknown business timezones to Melbourne', () => {
    expect(DEFAULT_BUSINESS_TIMEZONE).toBe('Australia/Melbourne');
    expect(formatBusinessTime('2026-07-16T22:00:00.000Z', 'Mars/Base')).toBe(
      '8:00 am',
    );
  });

  it('uses daylight-saving-aware timezone abbreviations', () => {
    expect(
      formatBusinessTimezoneAbbreviation(
        '2026-07-16T10:00:00.000Z',
        'Australia/Melbourne',
      ),
    ).toBe('AEST');
    expect(
      formatBusinessTimezoneAbbreviation(
        '2026-01-16T10:00:00.000Z',
        'Australia/Melbourne',
      ),
    ).toBe('AEDT');
    expect(
      formatBusinessTimezoneAbbreviation(
        '2026-07-16T10:00:00.000Z',
        'Australia/Adelaide',
      ),
    ).toBe('ACST');
    expect(
      formatBusinessTimezoneAbbreviation(
        '2026-01-16T10:00:00.000Z',
        'Australia/Adelaide',
      ),
    ).toBe('ACDT');
    expect(
      formatBusinessTimezoneAbbreviation(
        '2026-07-16T10:00:00.000Z',
        'Australia/Perth',
      ),
    ).toBe('AWST');
  });

  it('maps Australian states to sensible default timezones', () => {
    expect(timezoneForAustralianState('VIC')).toBe('Australia/Melbourne');
    expect(timezoneForAustralianState('QLD')).toBe('Australia/Brisbane');
    expect(timezoneForAustralianState('ACT')).toBe('Australia/Sydney');
  });

  it('calculates business day UTC ranges from the business timezone', () => {
    const range = getBusinessDayRangeUtc(
      '2026-07-16T10:00:00.000Z',
      'Australia/Melbourne',
    );

    expect(range.start.toISOString()).toBe('2026-07-15T14:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-07-16T14:00:00.000Z');
  });

  it('stores business-local appointment times as UTC instants', () => {
    const start = zonedTimeToUtc(
      { day: 24, hour: 7, minute: 30, month: 7, year: 2026 },
      'Australia/Sydney',
    );
    const end = zonedTimeToUtc(
      { day: 24, hour: 9, minute: 0, month: 7, year: 2026 },
      'Australia/Sydney',
    );

    expect(start.toISOString()).toBe('2026-07-23T21:30:00.000Z');
    expect(end.toISOString()).toBe('2026-07-23T23:00:00.000Z');
    expect(formatBusinessTimeRange(start, end, 'Australia/Sydney')).toBe(
      '7:30 am – 9:00 am',
    );
  });

  it('keeps demo appointment APT-2026-000002 inside Sydney business hours', () => {
    const start = zonedTimeToUtc(
      { day: 27, hour: 11, minute: 30, month: 7, year: 2026 },
      'Australia/Sydney',
    );
    const end = zonedTimeToUtc(
      { day: 27, hour: 12, minute: 30, month: 7, year: 2026 },
      'Australia/Sydney',
    );

    expect(start.toISOString()).toBe('2026-07-27T01:30:00.000Z');
    expect(end.toISOString()).toBe('2026-07-27T02:30:00.000Z');
    expect(formatBusinessTimeRange(start, end, 'Australia/Sydney')).toBe(
      '11:30 am – 12:30 pm',
    );
  });

  it('handles daylight-saving business day boundaries', () => {
    const range = getBusinessDayRangeUtc(
      '2026-10-04T02:00:00.000Z',
      'Australia/Melbourne',
    );

    expect(range.start.toISOString()).toBe('2026-10-03T14:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-04T13:00:00.000Z');
  });

  it('formats relative business-day labels', () => {
    const reference = '2026-07-24T02:00:00.000Z';

    expect(
      formatBusinessRelativeDay(
        '2026-07-23T23:00:00.000Z',
        reference,
        'Australia/Sydney',
      ),
    ).toBe('Today');
    expect(
      formatBusinessRelativeDay(
        '2026-07-24T23:00:00.000Z',
        reference,
        'Australia/Sydney',
      ),
    ).toBe('Tomorrow');
  });

  it.each([
    ['2026-07-23T18:59:00.000Z', 'Australia/Sydney', 'Hello, Mia'],
    ['2026-07-23T19:00:00.000Z', 'Australia/Sydney', 'Good morning, Mia'],
    ['2026-07-24T01:59:00.000Z', 'Australia/Sydney', 'Good morning, Mia'],
    ['2026-07-24T02:00:00.000Z', 'Australia/Sydney', 'Good afternoon, Mia'],
    ['2026-07-24T06:59:00.000Z', 'Australia/Sydney', 'Good afternoon, Mia'],
    ['2026-07-24T07:00:00.000Z', 'Australia/Sydney', 'Good evening, Mia'],
    ['2026-07-24T11:59:00.000Z', 'Australia/Sydney', 'Good evening, Mia'],
    ['2026-07-24T12:00:00.000Z', 'Australia/Sydney', 'Hello, Mia'],
  ])(
    'returns %s as %s for business-local greeting',
    (now, timezone, expected) => {
      expect(getBusinessGreeting({ firstName: 'Mia', now, timezone })).toBe(
        expected,
      );
    },
  );

  it('formats greetings without dangling comma when the name is missing', () => {
    expect(
      getBusinessGreeting({
        now: '2026-07-24T02:00:00.000Z',
        timezone: 'Australia/Sydney',
      }),
    ).toBe('Good afternoon');
  });

  it('uses business timezone instead of device or UTC hour for greetings', () => {
    const instant = '2026-01-15T01:30:00.000Z';

    expect(
      getBusinessGreeting({
        firstName: 'Mia',
        now: instant,
        timezone: 'Australia/Sydney',
      }),
    ).toBe('Good afternoon, Mia');
    expect(
      getBusinessGreeting({
        firstName: 'Mia',
        now: instant,
        timezone: 'Australia/Perth',
      }),
    ).toBe('Good morning, Mia');
  });

  it('handles Melbourne winter and Sydney daylight-saving greetings', () => {
    expect(
      getBusinessGreeting({
        firstName: 'Mia',
        now: '2026-07-15T02:30:00.000Z',
        timezone: 'Australia/Melbourne',
      }),
    ).toBe('Good afternoon, Mia');
    expect(
      getBusinessGreeting({
        firstName: 'Mia',
        now: '2026-01-15T06:30:00.000Z',
        timezone: 'Australia/Sydney',
      }),
    ).toBe('Good evening, Mia');
  });
});
