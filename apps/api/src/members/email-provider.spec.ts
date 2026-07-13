import {
  ConsoleEmailProvider,
  ResendEmailProvider,
  createEmailProvider,
} from './email-provider';

const inviteInput = {
  businessName: 'Demo Tradie Co',
  expiresAt: new Date('2026-07-20T00:00:00.000Z'),
  inviteUrl: 'http://localhost:8081/invite/local-token',
  inviterName: 'Olivia Owner',
  role: 'SCHEDULER' as const,
  to: 'scheduler@example.com',
};

describe('EmailProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses console provider when Resend is not configured', () => {
    const provider = createEmailProvider({
      fromName: 'TradieOS',
      provider: 'resend',
    });

    expect(provider).toBeInstanceOf(ConsoleEmailProvider);
  });

  it('does not expose invite URLs in production console logs', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const provider = new ConsoleEmailProvider(false);

    const result = await provider.sendTeamInvitation(inviteInput);

    expect(result).toEqual({ provider: 'console', status: 'SENT' });
    expect(info).toHaveBeenCalledWith(
      '[TradieOS email:INVITE]',
      expect.objectContaining({
        inviteUrl: '[hidden outside development]',
      }),
    );
  });

  it('reports Resend delivery failure without throwing provider errors', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ message: 'Invalid API key' }),
      ok: false,
      status: 401,
    } as Response);
    const provider = new ResendEmailProvider(
      'test-key',
      'TradieOS',
      'hello@example.com',
    );

    const result = await provider.sendTeamInvitation(inviteInput);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.any(Object),
    );
    expect(result).toMatchObject({
      error: 'Invalid API key',
      provider: 'resend',
      status: 'FAILED',
    });
  });
});
