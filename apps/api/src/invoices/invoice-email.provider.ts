export interface InvoiceEmailInput {
  to: string;
  subject: string;
  message: string;
  businessName: string;
  invoiceNumber: string;
  invoiceUrl: string;
  pdfFileName: string;
}

export type InvoiceEmailDeliveryResult = {
  provider: 'console';
  status: 'SENT' | 'FAILED';
  messageId?: string;
  error?: string;
};

export interface InvoiceEmailProvider {
  sendInvoice(input: InvoiceEmailInput): Promise<InvoiceEmailDeliveryResult>;
}

export class ConsoleInvoiceEmailProvider implements InvoiceEmailProvider {
  sendInvoice(input: InvoiceEmailInput): Promise<InvoiceEmailDeliveryResult> {
    console.info('[TradieOS invoice-email:SEND]', {
      businessName: input.businessName,
      invoiceNumber: input.invoiceNumber,
      invoiceUrl: input.invoiceUrl,
      message: input.message,
      pdfFileName: input.pdfFileName,
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
