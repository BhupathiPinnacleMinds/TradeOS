import {
  staleActiveAppointmentWarning,
  unusualExecutionDurationWarning,
} from '@tradieos/shared';

describe('appointment operational-state helpers', () => {
  const now = new Date('2026-09-08T02:00:00.000Z');

  it('does not warn for normal active execution durations', () => {
    const warning = staleActiveAppointmentWarning(
      {
        scheduledStart: '2026-09-08T00:30:00.000Z',
        status: 'ON_THE_WAY',
        travelStartedAt: '2026-09-08T00:35:00.000Z',
      },
      now,
    );

    expect(warning).toBeNull();
  });

  it('detects stale ON_THE_WAY appointments without mutating status history', () => {
    const warning = staleActiveAppointmentWarning(
      {
        scheduledStart: '2026-09-04T00:00:00.000Z',
        status: 'ON_THE_WAY',
        travelStartedAt: '2026-09-04T00:05:00.000Z',
      },
      now,
    );

    expect(warning).toMatchObject({
      code: 'STALE_ACTIVE_EXECUTION',
      thresholdMinutes: 720,
    });
    expect(warning?.elapsedMinutes).toBeGreaterThan(720);
  });

  it('detects stale paused work from the active pause timestamp', () => {
    const warning = staleActiveAppointmentWarning(
      {
        pausedAt: '2026-09-07T00:00:00.000Z',
        scheduledStart: '2026-09-07T00:00:00.000Z',
        status: 'PAUSED',
        workStartedAt: '2026-09-07T00:10:00.000Z',
      },
      now,
    );

    expect(warning?.code).toBe('STALE_ACTIVE_EXECUTION');
  });

  it('preserves true long completed durations while producing a review warning', () => {
    const warning = unusualExecutionDurationWarning({
      executionDurations: {
        calculatedAt: now.toISOString(),
        pausedMinutes: 1,
        totalElapsedMinutes: 1297,
        travelMinutes: 1,
        workMinutes: 1293,
      },
    });

    expect(warning).toMatchObject({
      code: 'UNUSUAL_EXECUTION_DURATION',
      elapsedMinutes: 1297,
    });
  });

  it('does not truncate or warn for ordinary completed durations', () => {
    const warning = unusualExecutionDurationWarning({
      executionDurations: {
        calculatedAt: now.toISOString(),
        pausedMinutes: 5,
        totalElapsedMinutes: 125,
        travelMinutes: 15,
        workMinutes: 105,
      },
    });

    expect(warning).toBeNull();
  });
});
