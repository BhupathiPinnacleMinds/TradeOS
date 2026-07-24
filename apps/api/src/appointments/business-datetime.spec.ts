import {
  formatBusinessDate,
  formatBusinessTime,
  formatBusinessTimeRange,
  formatBusinessTimezoneAbbreviation,
  getBusinessDayRangeUtc,
  timezoneForAustralianState,
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
});
