import type { InvoiceStatus } from '@tradieos/shared';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  AcceptInvitation: { token: string };
  PublicQuote: { token: string };
  PublicInvoice: { token: string };
  Main: undefined;
  MyDay: undefined;
  Quotes: undefined;
  QuoteDetails: { quoteId: string };
  QuoteForm:
    | {
        appointmentId?: string;
        customerId?: string;
        customerSiteId?: string;
        jobId?: string;
        quoteId?: string;
      }
    | undefined;
  Invoices: { status?: InvoiceStatus | 'OUTSTANDING' } | undefined;
  AccountsReceivable:
    | {
        customerId?: string;
        status?: 'OUTSTANDING' | 'OVERDUE' | 'DUE_SOON' | 'PAID';
      }
    | undefined;
  InvoiceDetails: { invoiceId: string };
  InvoiceForm:
    | {
        customerId?: string;
        customerSiteId?: string;
        invoiceId?: string;
        jobId?: string;
        sourceQuoteId?: string;
      }
    | undefined;
  Notifications: undefined;
  Settings: undefined;
  Customers: undefined;
  Team: undefined;
  TeamMemberProfile: { memberId: string };
  CustomerDetails: { customerId: string };
  CustomerForm: { customerId?: string };
  JobDetails: { jobId: string };
  JobForm: { jobId?: string; customerId?: string };
  Jobs: undefined;
  AppointmentDetails: { appointmentId: string };
  AppointmentReassign: { appointmentId: string };
  MediaEvidence:
    | {
        appointmentId?: string;
        customerId?: string;
        jobId?: string;
      }
    | undefined;
  MediaViewer: { mediaId: string };
  AppointmentForm:
    | {
        customerId?: string;
        customerSiteId?: string;
        jobId?: string;
        selectedDate?: string;
        siteId?: string;
        technicianId?: string | null;
      }
    | undefined;
};

export type MainTabsParamList = {
  Dashboard: undefined;
  MyDay: undefined;
  Calendar: undefined;
  Customers: undefined;
  Jobs: undefined;
  Quotes: undefined;
  Tori: undefined;
  More: undefined;
};
