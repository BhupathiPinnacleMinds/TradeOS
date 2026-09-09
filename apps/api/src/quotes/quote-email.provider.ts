import {
  createEmailProvider,
  type EmailDeliveryResult,
  type EmailProvider,
} from '../members/email-provider';

export interface QuoteEmailInput {
  to: string;
  subject: string;
  message: string;
  businessName: string;
  quoteNumber: string;
  quoteUrl: string;
  pdfFileName: string;
}

export type QuoteEmailDeliveryResult = EmailDeliveryResult;

export interface QuoteEmailProvider {
  sendQuote(input: QuoteEmailInput): Promise<QuoteEmailDeliveryResult>;
}

export class ConsoleQuoteEmailProvider implements QuoteEmailProvider {
  sendQuote(input: QuoteEmailInput): Promise<QuoteEmailDeliveryResult> {
    console.info('[TradieOS quote-email:SEND]', {
      businessName: input.businessName,
      message: input.message,
      pdfFileName: input.pdfFileName,
      quoteNumber: input.quoteNumber,
      quoteUrl: input.quoteUrl,
      subject: input.subject,
      to: input.to,
    });
    return Promise.resolve({
      messageId: `console-${Date.now()}`,
      provider: 'console',
      status: 'SENT',
    });
  }
}

export class ConfiguredQuoteEmailProvider implements QuoteEmailProvider {
  constructor(private readonly provider: EmailProvider) {}

  sendQuote(input: QuoteEmailInput): Promise<QuoteEmailDeliveryResult> {
    return this.provider.sendTransactionalEmail({
      html: quoteEmailHtml(input),
      subject: input.subject,
      text: quoteEmailText(input),
      to: input.to,
    });
  }
}

export function createQuoteEmailProvider(config: {
  apiKey?: string;
  fromAddress?: string;
  fromName?: string;
  isProduction?: boolean;
  provider?: string;
}): QuoteEmailProvider {
  return new ConfiguredQuoteEmailProvider(createEmailProvider(config));
}

function quoteEmailText(input: QuoteEmailInput) {
  return `${input.message}

Review quote ${input.quoteNumber}: ${input.quoteUrl}

A PDF copy is available from the secure quote link.`;
}

function quoteEmailHtml(input: QuoteEmailInput) {
  return `
    <p>${escapeHtml(input.message)}</p>
    <p><a href="${escapeHtml(input.quoteUrl)}">Review quote ${escapeHtml(
      input.quoteNumber,
    )}</a></p>
    <p>A PDF copy is available from the secure quote link.</p>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
