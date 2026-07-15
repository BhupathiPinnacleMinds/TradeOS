export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  AcceptInvitation: { token: string };
  Main: undefined;
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
  AppointmentDetails: { appointmentId: string };
  AppointmentReassign: { appointmentId: string };
  AppointmentForm:
    | {
        customerId?: string;
        jobId?: string;
        siteId?: string;
      }
    | undefined;
};

export type MainTabsParamList = {
  Dashboard: undefined;
  Calendar: undefined;
  Jobs: undefined;
  Tori: undefined;
  More: undefined;
};
