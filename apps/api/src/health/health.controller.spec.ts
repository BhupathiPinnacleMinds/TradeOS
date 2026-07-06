import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('returns the API health contract', () => {
    const response = controller.check();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('tradieos-api');
    expect(Number.isNaN(Date.parse(response.timestamp))).toBe(false);
  });
});
