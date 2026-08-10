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
    upcomingJobs: number;
    completedToday: number;
    overdueJobs: number;
    openJobs: number;
    todaysAppointments: number;
    upcomingAppointments: number;
    completedAppointmentsToday: number;
    myAppointments: number;
    lateAppointments: number;
    upcomingTodayAppointments: number;
    techniciansWorking: number;
    availableTechnicians: number;
    unassignedAppointments: number;
    openQuotes: number;
    draftQuotes: number;
    quotesAwaitingResponse: number;
    quotesViewedNotAccepted: number;
    acceptedQuotesNotConverted: number;
    quotesExpiringSoon: number;
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
  todayAppointments: Array<{
    id: string;
    appointmentNumber: string;
    jobId: string;
    jobTitle: string;
    status: string;
    startsAt: string;
    technicianName: string | null;
    customerName: string;
    address: string | null;
  }>;
  nextAppointment: {
    id: string;
    jobTitle: string;
    customerName: string;
    startsAt: string;
    technicianName: string | null;
  } | null;
  activeExecutionAppointment: {
    id: string;
    jobTitle: string;
    customerName: string;
    status: string;
    currentAction: string;
    technicianName: string | null;
  } | null;
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
