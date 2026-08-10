import { createHash } from 'crypto';
import type { Quote } from '@tradieos/shared';
import { formatAudCents } from '@tradieos/shared';

export interface QuotePdfResult {
  buffer: Buffer;
  checksum: string;
  fileName: string;
  mimeType: 'application/pdf';
}

export interface QuotePdfProvider {
  generateQuotePdf(input: {
    quote: Quote;
    business: {
      name: string;
      abn: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }): QuotePdfResult;
}

export class DeterministicQuotePdfProvider implements QuotePdfProvider {
  generateQuotePdf(input: {
    quote: Quote;
    business: {
      name: string;
      abn: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }): QuotePdfResult {
    const fileName = `Quote-${input.quote.quoteNumber}.pdf`;
    const lines = this.lines(input);
    const buffer = createSimplePdf(lines);
    return {
      buffer,
      checksum: createHash('sha256').update(buffer).digest('hex'),
      fileName,
      mimeType: 'application/pdf',
    };
  }

  private lines(input: {
    quote: Quote;
    business: {
      name: string;
      abn: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
    };
  }) {
    const { business, quote } = input;
    const address = [
      business.address,
      business.suburb,
      business.state,
      business.postcode,
    ]
      .filter(Boolean)
      .join(', ');
    const serviceAddress = quote.customerSite
      ? [
          quote.customerSite.addressLine1,
          quote.customerSite.addressLine2,
          quote.customerSite.suburb,
          quote.customerSite.state,
          quote.customerSite.postcode,
        ]
          .filter(Boolean)
          .join(', ')
      : 'Address to be confirmed';

    return [
      business.name,
      business.abn ? `ABN ${business.abn}` : null,
      business.phone,
      business.email,
      address,
      '',
      `Quote ${quote.quoteNumber}`,
      quote.title,
      `Status: ${quote.status}`,
      `Issue: ${formatAuDate(quote.issueDate)}`,
      quote.expiryDate ? `Expiry: ${formatAuDate(quote.expiryDate)}` : null,
      '',
      `Customer: ${quote.customer.displayName}`,
      quote.customer.email ? `Email: ${quote.customer.email}` : null,
      quote.customer.phone ? `Phone: ${quote.customer.phone}` : null,
      `Service address: ${serviceAddress}`,
      '',
      quote.description,
      '',
      'Line items',
      ...quote.lineItems.map(
        (item) =>
          `${item.name} | ${item.quantity} ${item.unit} | ${formatAudCents(
            item.unitPriceCents,
          )} | ${formatAudCents(item.lineTotalCents)}`,
      ),
      '',
      `Subtotal: ${formatAudCents(quote.subtotalCents)}`,
      `Discount: ${formatAudCents(quote.discountCents)}`,
      `GST: ${formatAudCents(quote.gstCents)}`,
      `Total: ${formatAudCents(quote.totalCents)}`,
      `Deposit requested: ${formatAudCents(quote.depositCents)}`,
      '',
      'Customer notes',
      quote.customerNotes || 'No customer notes.',
      '',
      'Terms and conditions',
      quote.termsAndConditions || 'No terms added.',
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
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
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
