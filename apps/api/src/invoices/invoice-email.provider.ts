import {
  createEmailProvider,
  type EmailDeliveryResult,
  type EmailProvider,
} from '../members/email-provider';
import type { InvoicePaymentInstructions } from '@tradieos/shared';

export interface InvoiceEmailInput {
  to: string;
  subject: string;
  message: string;
  businessName: string;
  invoiceNumber: string;
  invoiceUrl: string;
  paymentInstructions?: InvoicePaymentInstructions;
  pdfFileName: string;
}

export type InvoiceEmailDeliveryResult = EmailDeliveryResult;

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

export class ConfiguredInvoiceEmailProvider implements InvoiceEmailProvider {
  constructor(private readonly provider: EmailProvider) {}

  sendInvoice(input: InvoiceEmailInput): Promise<InvoiceEmailDeliveryResult> {
    return this.provider.sendTransactionalEmail({
      html: invoiceEmailHtml(input),
      subject: input.subject,
      text: invoiceEmailText(input),
      to: input.to,
    });
  }
}

export function createInvoiceEmailProvider(config: {
  apiKey?: string;
  fromAddress?: string;
  fromName?: string;
  isProduction?: boolean;
  provider?: string;
}): InvoiceEmailProvider {
  return new ConfiguredInvoiceEmailProvider(createEmailProvider(config));
}

function invoiceEmailText(input: InvoiceEmailInput) {
  return `${input.message}

Review invoice ${input.invoiceNumber}: ${input.invoiceUrl}

A PDF copy is available from the secure invoice link.${paymentInstructionsText(
    input.paymentInstructions,
  )}`;
}

function invoiceEmailHtml(input: InvoiceEmailInput) {
  return `
    <p>${escapeHtml(input.message)}</p>
    <p><a href="${escapeHtml(input.invoiceUrl)}">Review invoice ${escapeHtml(
      input.invoiceNumber,
    )}</a></p>
    <p>A PDF copy is available from the secure invoice link.</p>
    ${paymentInstructionsHtml(input.paymentInstructions)}
  `;
}

function paymentInstructionsText(instructions?: InvoicePaymentInstructions) {
  if (!instructions?.hasBankDetails) return '';
  return `

Payment details:
Account name: ${instructions.accountName}
${instructions.bankName ? `Bank: ${instructions.bankName}\n` : ''}BSB: ${
    instructions.bsb
  }
Account number: ${instructions.accountNumber}
Reference: ${instructions.reference}${
    instructions.customInstructions
      ? `\n${instructions.customInstructions}`
      : ''
  }`;
}

function paymentInstructionsHtml(instructions?: InvoicePaymentInstructions) {
  if (!instructions?.hasBankDetails) return '';
  return `
    <p><strong>Payment details</strong><br />
    Account name: ${escapeHtml(instructions.accountName ?? '')}<br />
    ${
      instructions.bankName
        ? `Bank: ${escapeHtml(instructions.bankName)}<br />`
        : ''
    }
    BSB: ${escapeHtml(instructions.bsb ?? '')}<br />
    Account number: ${escapeHtml(instructions.accountNumber ?? '')}<br />
    Reference: ${escapeHtml(instructions.reference)}</p>
    ${
      instructions.customInstructions
        ? `<p>${escapeHtml(instructions.customInstructions)}</p>`
        : ''
    }
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
