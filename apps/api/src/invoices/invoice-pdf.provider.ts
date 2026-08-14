import { createHash } from 'crypto';
import type { Invoice, InvoicePayment } from '@tradieos/shared';
import { formatAudCents } from '@tradieos/shared';

export interface InvoicePdfResult {
  buffer: Buffer;
  checksum: string;
  fileName: string;
  mimeType: 'application/pdf';
}

export interface InvoicePdfProvider {
  generateInvoicePdf(input: {
    invoice: Invoice;
    business: {
      name: string;
      abn: string | null;
      gstRegistered: boolean;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }): InvoicePdfResult;
  generateReceiptPdf(input: {
    receiptNumber: string;
    invoice: Invoice;
    payment: InvoicePayment;
    business: {
      name: string;
      abn: string | null;
      gstRegistered: boolean;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }): InvoicePdfResult;
}

export class DeterministicInvoicePdfProvider implements InvoicePdfProvider {
  generateInvoicePdf(input: {
    invoice: Invoice;
    business: {
      name: string;
      abn: string | null;
      gstRegistered: boolean;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }): InvoicePdfResult {
    const fileName = `Invoice-${input.invoice.invoiceNumber}.pdf`;
    const lines = this.lines(input);
    const buffer = createSimplePdf(lines);
    return {
      buffer,
      checksum: createHash('sha256').update(buffer).digest('hex'),
      fileName,
      mimeType: 'application/pdf',
    };
  }

  generateReceiptPdf(input: {
    receiptNumber: string;
    invoice: Invoice;
    payment: InvoicePayment;
    business: {
      name: string;
      abn: string | null;
      gstRegistered: boolean;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }): InvoicePdfResult {
    const fileName = `Receipt-${input.receiptNumber}.pdf`;
    const lines = this.receiptLines(input);
    const buffer = createSimplePdf(lines);
    return {
      buffer,
      checksum: createHash('sha256').update(buffer).digest('hex'),
      fileName,
      mimeType: 'application/pdf',
    };
  }

  private lines(input: {
    invoice: Invoice;
    business: {
      name: string;
      abn: string | null;
      gstRegistered: boolean;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }) {
    const { business, invoice } = input;
    const businessAddress = [
      business.address,
      business.suburb,
      business.state,
      business.postcode,
    ]
      .filter(Boolean)
      .join(', ');
    const serviceAddress = invoice.customerSite
      ? [
          invoice.customerSite.addressLine1,
          invoice.customerSite.addressLine2,
          invoice.customerSite.suburb,
          invoice.customerSite.state,
          invoice.customerSite.postcode,
        ]
          .filter(Boolean)
          .join(', ')
      : 'Service address to be confirmed';
    const title =
      business.gstRegistered && invoice.gstCents > 0
        ? 'Tax Invoice'
        : 'Invoice';

    return [
      business.name,
      business.abn ? `ABN ${business.abn}` : null,
      business.phone,
      business.email,
      businessAddress,
      '',
      title,
      invoice.invoiceNumber,
      invoice.title,
      `Status: ${invoice.displayStatus}`,
      `Issue: ${formatAuDate(invoice.issueDate)}`,
      `Due: ${formatAuDate(invoice.dueDate)}`,
      '',
      `Customer: ${invoice.customer.displayName}`,
      invoice.customer.email ? `Email: ${invoice.customer.email}` : null,
      invoice.customer.phone ? `Phone: ${invoice.customer.phone}` : null,
      invoice.job ? `Source job: ${invoice.job.jobNumber}` : null,
      invoice.sourceQuote
        ? `Source quote: ${invoice.sourceQuote.quoteNumber}`
        : null,
      `Service address: ${serviceAddress}`,
      '',
      invoice.description,
      '',
      'Line items',
      ...invoice.lineItems.map(
        (item) =>
          `${item.name} | ${item.quantity} ${item.unit} | ${formatAudCents(
            item.unitPriceCents,
          )} | GST ${formatAudCents(item.lineGstCents)} | ${formatAudCents(
            item.lineTotalCents,
          )}`,
      ),
      '',
      `Subtotal: ${formatAudCents(invoice.subtotalCents)}`,
      `Discount: ${formatAudCents(invoice.discountCents)}`,
      `GST: ${formatAudCents(invoice.gstCents)}`,
      `Total: ${formatAudCents(invoice.totalCents)}`,
      `Credit applied: ${formatAudCents(invoice.creditAppliedCents)}`,
      `Amount paid: ${formatAudCents(invoice.amountPaidCents)}`,
      `Balance due: ${formatAudCents(invoice.balanceDueCents)}`,
      '',
      'Payment instructions',
      invoice.paymentTerms || 'Payment instructions to be confirmed.',
      '',
      'Customer notes',
      invoice.customerNotes || 'No customer notes.',
    ].filter((line): line is string => line !== null && line !== undefined);
  }

  private receiptLines(input: {
    receiptNumber: string;
    invoice: Invoice;
    payment: InvoicePayment;
    business: {
      name: string;
      abn: string | null;
      gstRegistered: boolean;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }) {
    const { business, invoice, payment, receiptNumber } = input;
    const businessAddress = [
      business.address,
      business.suburb,
      business.state,
      business.postcode,
    ]
      .filter(Boolean)
      .join(', ');

    return [
      business.name,
      business.abn ? `ABN ${business.abn}` : null,
      business.phone,
      business.email,
      businessAddress,
      '',
      'Payment Receipt',
      `Receipt: ${receiptNumber}`,
      `Invoice: ${invoice.invoiceNumber}`,
      `Customer: ${invoice.customer.displayName}`,
      invoice.customer.email ? `Email: ${invoice.customer.email}` : null,
      '',
      `Payment date: ${formatAuDate(payment.receivedAt)}`,
      `Payment amount: ${formatAudCents(payment.amountCents)}`,
      `Payment method: ${payment.method.replaceAll('_', ' ')}`,
      payment.reference ? `Reference: ${payment.reference}` : null,
      '',
      `Invoice total: ${formatAudCents(invoice.totalCents)}`,
      `Total paid: ${formatAudCents(invoice.amountPaidCents)}`,
      `Remaining balance: ${formatAudCents(invoice.balanceDueCents)}`,
      '',
      'Thank you for your payment.',
    ].filter((line): line is string => line !== null && line !== undefined);
  }
}

function formatAuDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function createSimplePdf(lines: string[]) {
  const escapedLines = lines.flatMap((line) => wrap(line, 92));
  const pageLineCount = 52;
  const pages =
    escapedLines.length > 0 ? chunk(escapedLines, pageLineCount) : [['']];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const pageObjectIds: number[] = [];

  pages.forEach((pageLines) => {
    const content = pageLines
      .map(
        (line, index) =>
          `BT /F1 10 Tf 50 ${780 - index * 14} Td (${escapePdf(line)}) Tj ET`,
      )
      .join('\n');
    const contentObjectId = objects.length + 1;
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    );
    const pageObjectId = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    pageObjectIds.push(pageObjectId);
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((pageObjectId) => `${pageObjectId} 0 R`)
    .join(' ')}] /Count ${pageObjectIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function wrap(value: string, width: number) {
  if (!value) return [''];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapePdf(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}
