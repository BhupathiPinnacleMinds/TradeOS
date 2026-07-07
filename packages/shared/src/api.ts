export interface HealthResponse {
  status: 'ok';
  service: 'tradieos-api';
  timestamp: string;
}

export interface DashboardSummaryResponse {
  business: {
    id: string;
    name: string;
    timezone: string;
  };
  counts: {
    customers: number;
    jobsToday: number;
    openJobs: number;
    openQuotes: number;
    unpaidInvoices: number;
    unreadNotifications: number;
    aiMessages: number;
  };
  money: {
    outstandingInvoicesCents: number;
  };
  todayJobs: Array<{
    id: string;
    title: string;
    status: string;
    startsAt: string | null;
    customerName: string;
    address: string | null;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    status: string;
    createdAt: string;
  }>;
  toriPriority: {
    title: string;
    body: string;
  };
}
