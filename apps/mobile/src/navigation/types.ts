export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  AcceptInvitation: { token: string };
  Main: undefined;
  Quotes: undefined;
  Invoices: undefined;
  Notifications: undefined;
  Settings: undefined;
  Team: undefined;
  TeamMemberProfile: { memberId: string };
  CustomerDetails: { customerId: string };
  CustomerForm: { customerId?: string };
  JobDetails: { jobId: string };
  JobForm: { jobId?: string; customerId?: string };
};

export type MainTabsParamList = {
  Dashboard: undefined;
  Tori: undefined;
  Customers: undefined;
  Jobs: undefined;
  More: undefined;
};
