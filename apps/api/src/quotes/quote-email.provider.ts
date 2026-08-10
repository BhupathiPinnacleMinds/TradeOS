export interface QuoteEmailInput {
  to: string;
  subject: string;
  message: string;
  businessName: string;
  quoteNumber: string;
  quoteUrl: string;
  pdfFileName: string;
}

export type QuoteEmailDeliveryResult = {
  provider: 'console';
  status: 'SENT' | 'FAILED';
  messageId?: string;
  error?: string;
};

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
