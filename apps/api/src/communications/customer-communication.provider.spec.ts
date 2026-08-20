import { ConfigService } from '@nestjs/config';
import {
  createCustomerCommunicationProvider,
  normaliseAustralianMobileForSms,
  ResendCustomerEmailProvider,
  TwilioCustomerSmsProvider,
} from './customer-communication.provider';

const originalFetch = global.fetch;

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'business-1',
    channel: 'EMAIL' as const,
    communicationId: 'communication-1',
    entityReference: 'quote-1',
    message: 'Hi Mohith, quote Q-1 is ready. Review: https://app.example/q/1',
    recipient: 'mohith@example.test',
    subject: 'Quote Q-1',
    type: 'QUOTE_SENT',
    ...overrides,
  };
}

function response(status: number, body: Record<string, unknown>) {
  return Promise.resolve({
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
  } as Response);
}

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function createFetchMock(
  mockedResponse?: Promise<Response>,
): jest.MockedFunction<typeof fetch> {
  return jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockReturnValue(mockedResponse ?? response(200, {}));
}

function fetchInitAt(
  fetchMock: jest.MockedFunction<typeof fetch>,
  index = 0,
): RequestInit {
  const init = fetchMock.mock.calls[index]?.[1];
  if (!init) {
    throw new Error('Expected fetch to be called with request options.');
  }
  return init;
}

describe('CustomerCommunicationProvider', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([
    ['0422462867', '+61422462867'],
    ['0422 462 867', '+61422462867'],
    ['+61422462867', '+61422462867'],
    ['+61 422 462 867', '+61422462867'],
    ['+61 422-462-867', '+61422462867'],
  ])('normalises Australian mobile %s for SMS', (input, expected) => {
    expect(normaliseAustralianMobileForSms(input)).toBe(expected);
  });

  it('rejects non-mobile SMS recipients', () => {
    expect(normaliseAustralianMobileForSms('Piza')).toBeNull();
    expect(normaliseAustralianMobileForSms('0399999999')).toBeNull();
  });

  it('sends customer email through Resend and returns the message id', async () => {
    const fetchMock = createFetchMock(response(200, { id: 'em_123' }));
    global.fetch = fetchMock;
    const provider = new ResendCustomerEmailProvider(
      're_secret',
      'TradieOS',
      'hello@tradieos.example',
    );

    const result = await provider.send(delivery());

    expect(result).toEqual({
      provider: 'resend',
      providerMessageId: 'em_123',
      status: 'SENT',
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const init = fetchInitAt(fetchMock);
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBe('Bearer re_secret');
    if (typeof init.body !== 'string') {
      throw new Error('Expected Resend request body to be JSON.');
    }
    const payload = JSON.parse(init.body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      subject: 'Quote Q-1',
      text: delivery().message,
      to: 'mohith@example.test',
    });
    expect(String(payload.html)).not.toContain('business-1');
  });

  it('maps Resend provider failures without leaking authorization headers', async () => {
    global.fetch = createFetchMock(
      response(401, { message: 'Invalid API key' }),
    );
    const provider = new ResendCustomerEmailProvider(
      're_secret',
      'TradieOS',
      'hello@tradieos.example',
    );

    const result = await provider.send(delivery());

    expect(result).toMatchObject({
      failureReason: 'Invalid API key',
      provider: 'resend',
      status: 'FAILED',
    });
    if (result.status !== 'FAILED') {
      throw new Error('Expected Resend delivery to fail.');
    }
    expect(result.failureReason).not.toContain('re_secret');
  });

  it('sends customer SMS through Twilio and returns the message id', async () => {
    const fetchMock = createFetchMock(response(201, { sid: 'SM123' }));
    global.fetch = fetchMock;
    const provider = new TwilioCustomerSmsProvider(
      'AC123',
      'auth-token',
      '+61400000000',
    );

    const result = await provider.send(
      delivery({
        channel: 'SMS',
        recipient: '+61 422 462 867',
        subject: null,
      }),
    );

    expect(result).toEqual({
      provider: 'twilio',
      providerMessageId: 'SM123',
      status: 'SENT',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = fetchInitAt(fetchMock).body as URLSearchParams;
    expect(body.get('To')).toBe('+61422462867');
    expect(body.get('From')).toBe('+61400000000');
  });

  it('does not send SMS when the recipient is not an Australian mobile number', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const provider = new TwilioCustomerSmsProvider(
      'AC123',
      'auth-token',
      '+61400000000',
    );

    const result = await provider.send(
      delivery({ channel: 'SMS', recipient: '0399999999' }),
    );

    expect(result).toMatchObject({
      failureReason: 'COMMUNICATION_INVALID_SMS_RECIPIENT',
      provider: 'twilio',
      status: 'FAILED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates local providers for development without real credentials', async () => {
    const provider = createCustomerCommunicationProvider(
      config({
        CUSTOMER_EMAIL_PROVIDER: 'local',
        CUSTOMER_SMS_PROVIDER: 'local',
      }),
    );

    await expect(provider.send(delivery())).resolves.toMatchObject({
      provider: 'local-email',
      status: 'SENT',
    });
    await expect(
      provider.send(delivery({ channel: 'SMS', recipient: '0422462867' })),
    ).resolves.toMatchObject({
      provider: 'local-sms',
      status: 'SENT',
    });
  });

  it('fails fast when real provider config is incomplete', () => {
    expect(() =>
      createCustomerCommunicationProvider(
        config({ CUSTOMER_EMAIL_PROVIDER: 'resend' }),
      ),
    ).toThrow(/RESEND_API_KEY/);
    expect(() =>
      createCustomerCommunicationProvider(
        config({
          CUSTOMER_EMAIL_PROVIDER: 'local',
          CUSTOMER_SMS_PROVIDER: 'twilio',
        }),
      ),
    ).toThrow(/TWILIO_ACCOUNT_SID/);
  });
});
