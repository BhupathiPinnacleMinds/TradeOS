import {
  formatAudCents,
  formatBusinessDate,
  formatBusinessTimeRange,
} from '@tradieos/shared';

type Business = {
  email: string | null;
  name: string;
  phone: string | null;
  timezone?: string | null;
};

type Customer = {
  displayName: string;
};

export type CommunicationTemplate = {
  message: string;
  subject: string | null;
};

function contactLine(business: Business) {
  return [business.phone, business.email].filter(Boolean).join(' | ');
}

export function appointmentConfirmationTemplate(input: {
  appointmentType: string;
  business: Business;
  customer: Customer;
  end: Date;
  jobTitle: string;
  serviceAddress: string;
  start: Date;
}): CommunicationTemplate {
  const timezone = input.business.timezone ?? 'Australia/Melbourne';
  return {
    subject: `Appointment confirmed with ${input.business.name}`,
    message: [
      `Hi ${input.customer.displayName}, your ${input.appointmentType.toLowerCase().replaceAll('_', ' ')} appointment with ${input.business.name} is confirmed.`,
      `Service: ${input.jobTitle}`,
      `Date: ${formatBusinessDate(input.start, timezone)}`,
      `Time: ${formatBusinessTimeRange(input.start, input.end, timezone)}`,
      `Address: ${input.serviceAddress}`,
      contactLine(input.business)
        ? `Questions? Contact us on ${contactLine(input.business)}.`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function appointmentReminderTemplate(input: {
  business: Business;
  customer: Customer;
  end: Date;
  jobTitle: string;
  serviceAddress: string;
  start: Date;
}): CommunicationTemplate {
  const timezone = input.business.timezone ?? 'Australia/Melbourne';
  return {
    subject: `Reminder: appointment with ${input.business.name}`,
    message: [
      `Hi ${input.customer.displayName}, this is a friendly reminder for your upcoming appointment with ${input.business.name}.`,
      `Service: ${input.jobTitle}`,
      `Date: ${formatBusinessDate(input.start, timezone)}`,
      `Time: ${formatBusinessTimeRange(input.start, input.end, timezone)}`,
      `Address: ${input.serviceAddress}`,
    ].join('\n'),
  };
}

export function appointmentRescheduledTemplate(input: {
  business: Business;
  customer: Customer;
  end: Date;
  jobTitle: string;
  serviceAddress: string;
  start: Date;
}): CommunicationTemplate {
  const timezone = input.business.timezone ?? 'Australia/Melbourne';
  return {
    subject: `Appointment rescheduled with ${input.business.name}`,
    message: [
      `Hi ${input.customer.displayName}, your appointment with ${input.business.name} has been rescheduled.`,
      `Service: ${input.jobTitle}`,
      `New date: ${formatBusinessDate(input.start, timezone)}`,
      `New time: ${formatBusinessTimeRange(input.start, input.end, timezone)}`,
      `Address: ${input.serviceAddress}`,
    ].join('\n'),
  };
}

export function appointmentCancelledTemplate(input: {
  business: Business;
  customer: Customer;
  jobTitle: string;
}): CommunicationTemplate {
  return {
    subject: `Appointment cancelled with ${input.business.name}`,
    message: `Hi ${input.customer.displayName}, your appointment for ${input.jobTitle} has been cancelled. Please contact ${input.business.name} if you have any questions.`,
  };
}

export function quoteFollowUpTemplate(input: {
  business: Business;
  customer: Customer;
  expiryDate: Date | null;
  quoteNumber: string;
  quoteUrl: string;
  totalCents: number;
}): CommunicationTemplate {
  return {
    subject: `Following up quote ${input.quoteNumber}`,
    message: [
      `Hi ${input.customer.displayName}, just following up on quote ${input.quoteNumber} from ${input.business.name}.`,
      `Total: ${formatAudCents(input.totalCents)}`,
      input.expiryDate
        ? `Valid until: ${formatBusinessDate(input.expiryDate, input.business.timezone ?? 'Australia/Melbourne')}`
        : null,
      `Review quote: ${input.quoteUrl}`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function invoiceDueSoonTemplate(input: {
  amountPaidCents: number;
  balanceDueCents: number;
  business: Business;
  customer: Customer;
  dueDate: Date;
  invoiceNumber: string;
  invoiceUrl: string;
  totalCents: number;
}): CommunicationTemplate {
  return {
    subject: `Invoice ${input.invoiceNumber} due soon`,
    message: [
      `Hi ${input.customer.displayName}, invoice ${input.invoiceNumber} from ${input.business.name} is due soon.`,
      `Due date: ${formatBusinessDate(input.dueDate, input.business.timezone ?? 'Australia/Melbourne')}`,
      `Invoice total: ${formatAudCents(input.totalCents)}`,
      `Paid: ${formatAudCents(input.amountPaidCents)}`,
      `Remaining: ${formatAudCents(input.balanceDueCents)}`,
      `View invoice: ${input.invoiceUrl}`,
    ].join('\n'),
  };
}

export function invoiceOverdueTemplate(input: {
  amountPaidCents: number;
  balanceDueCents: number;
  business: Business;
  customer: Customer;
  dueDate: Date;
  invoiceNumber: string;
  invoiceUrl: string;
  totalCents: number;
}): CommunicationTemplate {
  return {
    subject: `Invoice ${input.invoiceNumber} is overdue`,
    message: [
      `Hi ${input.customer.displayName}, invoice ${input.invoiceNumber} from ${input.business.name} is now overdue.`,
      `Due date: ${formatBusinessDate(input.dueDate, input.business.timezone ?? 'Australia/Melbourne')}`,
      `Invoice total: ${formatAudCents(input.totalCents)}`,
      `Paid: ${formatAudCents(input.amountPaidCents)}`,
      `Remaining: ${formatAudCents(input.balanceDueCents)}`,
      `View invoice: ${input.invoiceUrl}`,
    ].join('\n'),
  };
}

export function paymentReceivedTemplate(input: {
  amountCents: number;
  balanceDueCents: number;
  business: Business;
  customer: Customer;
  invoiceNumber: string;
  method: string;
  receivedAt: Date;
  totalPaidCents: number;
}): CommunicationTemplate {
  const fullyPaid = input.balanceDueCents === 0;
  return {
    subject: `Payment received for invoice ${input.invoiceNumber}`,
    message: [
      `Hi ${input.customer.displayName}, thanks — ${input.business.name} received your payment for invoice ${input.invoiceNumber}.`,
      `Amount received: ${formatAudCents(input.amountCents)}`,
      `Payment date: ${formatBusinessDate(input.receivedAt, input.business.timezone ?? 'Australia/Melbourne')}`,
      `Payment method: ${input.method.replaceAll('_', ' ')}`,
      `Total paid: ${formatAudCents(input.totalPaidCents)}`,
      fullyPaid
        ? 'This invoice is now fully paid.'
        : `Remaining balance: ${formatAudCents(input.balanceDueCents)}`,
    ].join('\n'),
  };
}

export function jobCompletedTemplate(input: {
  business: Business;
  customer: Customer;
  jobTitle: string;
}): CommunicationTemplate {
  return {
    subject: `Job completed by ${input.business.name}`,
    message: `Hi ${input.customer.displayName}, ${input.business.name} has marked ${input.jobTitle} as complete. Thank you for choosing us.`,
  };
}
