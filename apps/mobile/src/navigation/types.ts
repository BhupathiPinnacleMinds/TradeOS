export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  AcceptInvitation: { token: string };
  Main: undefined;
  MyDay: undefined;
  Quotes: undefined;
  Invoices: undefined;
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
