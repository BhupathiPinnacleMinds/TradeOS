import type { DashboardSummaryResponse } from '@tradieos/shared';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessDateTime,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    currency: 'AUD',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(cents / 100);
}

function formatAppointmentTime(
  value: string,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE,
) {
  return formatBusinessDateTime(value, timezone);
}

export function DashboardScreen() {
  const navigation = useNavigation<Navigation>();
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const businessTimezone = normaliseBusinessTimezone(
    summary?.business.timezone ?? user?.business.timezone,
  );

  const loadSummary = useCallback(
    async (shouldApply: () => boolean = () => true) => {
      if (shouldApply()) {
        setIsLoading(true);
        setError(null);
      }

      try {
        if (!token) {
          throw new Error('You are not logged in');
        }

        const nextSummary = await apiRequest<DashboardSummaryResponse>(
          '/dashboard/summary',
          { token },
        );
        if (shouldApply()) {
          setSummary(nextSummary);
        }
      } catch (loadError) {
        if (shouldApply()) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load dashboard summary',
          );
        }
      } finally {
        if (shouldApply()) {
          setIsLoading(false);
        }
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      void loadSummary(() => isActive);

      return () => {
        isActive = false;
      };
    }, [loadSummary]),
  );

  const nextAppointment = summary?.nextAppointment;
  const activeExecution = summary?.activeExecutionAppointment;
  const previewAppointments = summary?.todayAppointments.slice(0, 2) ?? [];

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.greeting}>
              Good morning{user?.firstName ? `, ${user.firstName}` : ''}
            </Text>
            <Text style={styles.title}>
              {summary?.business.name ?? 'Dashboard'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Open notifications"
            accessibilityRole="button"
            onPress={() => navigation.navigate('Notifications')}
            style={({ pressed }) => [
              styles.notificationButton,
              pressed && styles.cardPressed,
            ]}
          >
            <Text style={styles.notificationValue}>
              {summary?.counts.unreadNotifications ?? '-'}
            </Text>
            <Text style={styles.notificationLabel}>Alerts</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.tori} />
            <Text style={styles.stateText}>
              Loading your business dashboard...
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Dashboard API unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorBody}>
              Check the API is running and your phone/browser can reach it.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadSummary()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.summaryCard, styles.todayCard]}>
          <SectionHeader eyebrow="TODAY" title="Operational run" />
          <View style={styles.heroMetricRow}>
            <HeroMetric
              label="Appointments"
              value={summary?.counts.todaysAppointments}
            />
            <HeroMetric label="Jobs" value={summary?.counts.jobsToday} />
            <HeroMetric
              label="Upcoming"
              value={summary?.counts.upcomingTodayAppointments}
            />
          </View>

          <DashboardRow
            label="Next appointment"
            meta={
              nextAppointment
                ? `${nextAppointment.customerName} · ${
                    nextAppointment.technicianName ?? 'Unassigned'
                  }`
                : 'No upcoming appointment found'
            }
            onPress={
              nextAppointment
                ? () =>
                    navigation.navigate('AppointmentDetails', {
                      appointmentId: nextAppointment.id,
                    })
                : undefined
            }
            value={
              nextAppointment
                ? formatAppointmentTime(
                    nextAppointment.startsAt,
                    businessTimezone,
                  )
                : 'Clear'
            }
          />

          <DashboardRow
            label="Active field work"
            meta={
              activeExecution
                ? `${activeExecution.customerName} · ${
                    activeExecution.technicianName ?? 'Unassigned'
                  }`
                : 'No technician is actively travelling or working right now'
            }
            onPress={
              activeExecution
                ? () =>
                    navigation.navigate('AppointmentDetails', {
                      appointmentId: activeExecution.id,
                    })
                : undefined
            }
            value={activeExecution?.currentAction ?? 'None'}
          />

          {previewAppointments.length ? (
            <View style={styles.todayPreview}>
              <Text style={styles.previewTitle}>Next on the schedule</Text>
              {previewAppointments.map((appointment) => (
                <Pressable
                  accessibilityLabel={`Open appointment ${appointment.appointmentNumber}`}
                  accessibilityRole="button"
                  key={appointment.id}
                  onPress={() =>
                    navigation.navigate('AppointmentDetails', {
                      appointmentId: appointment.id,
                    })
                  }
                  style={({ pressed }) => [
                    styles.previewItem,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <Text style={styles.previewTime}>
                    {formatAppointmentTime(
                      appointment.startsAt,
                      businessTimezone,
                    )}
                  </Text>
                  <View style={styles.previewCopy}>
                    <Text numberOfLines={1} style={styles.itemTitle}>
                      {appointment.jobTitle}
                    </Text>
                    <Text numberOfLines={1} style={styles.itemMeta}>
                      {appointment.customerName} ·{' '}
                      {appointment.technicianName ?? 'Unassigned'}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.summaryCard}>
          <SectionHeader eyebrow="NEEDS ATTENTION" title="Action queue" />
          <DashboardRow
            label="Overdue invoices"
            onPress={() =>
              navigation.navigate('AccountsReceivable', { status: 'OVERDUE' })
            }
            tone="warning"
            value={summary?.counts.overdueInvoices ?? '-'}
          />
          <DashboardRow
            label="Late appointments"
            tone="warning"
            value={summary?.counts.lateAppointments ?? '-'}
          />
          <DashboardRow
            label="Unassigned appointments"
            tone="warning"
            value={summary?.counts.unassignedAppointments ?? '-'}
          />
          <DashboardRow
            label="Quotes awaiting response"
            tone="warning"
            value={summary?.counts.quotesAwaitingResponse ?? '-'}
          />
          <DashboardRow
            label="Quotes expiring soon"
            tone="warning"
            value={summary?.counts.quotesExpiringSoon ?? '-'}
          />
          <DashboardRow
            label="Draft invoices"
            onPress={() => navigation.navigate('Invoices', { status: 'DRAFT' })}
            value={summary?.counts.draftInvoices ?? '-'}
          />
          <DashboardRow
            label="Unread alerts"
            onPress={() => navigation.navigate('Notifications')}
            value={summary?.counts.unreadNotifications ?? '-'}
          />
        </View>

        <View style={styles.summaryCard}>
          <SectionHeader eyebrow="MONEY" title="Financial snapshot" />
          <Pressable
            accessibilityLabel="Open outstanding invoices"
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('AccountsReceivable', {
                status: 'OUTSTANDING',
              })
            }
            style={({ pressed }) => [
              styles.moneyHero,
              pressed && styles.cardPressed,
            ]}
          >
            <Text style={styles.moneyLabel}>Outstanding</Text>
            <Text style={styles.moneyValue}>
              {summary
                ? formatCurrency(summary.money.outstandingInvoicesCents)
                : '-'}
            </Text>
          </Pressable>
          <View style={styles.grid}>
            <MetricCard
              label="Paid today"
              onPress={() =>
                navigation.navigate('AccountsReceivable', { status: 'PAID' })
              }
              value={
                summary
                  ? formatCurrency(summary.money.paidTodayCents)
                  : undefined
              }
            />
            <MetricCard
              label="Unpaid invoices"
              onPress={() =>
                navigation.navigate('AccountsReceivable', {
                  status: 'OUTSTANDING',
                })
              }
              value={summary?.counts.unpaidInvoices}
            />
          </View>
        </View>

        <View style={styles.toriCard}>
          <Text style={styles.toriLabel}>TORI'S DAILY PRIORITIES</Text>
          <Text style={styles.toriTitle}>
            {summary?.toriPriority.title ?? 'Waiting for dashboard data'}
          </Text>
          <Text style={styles.toriBody}>
            {summary?.toriPriority.body ??
              'Tori will surface jobs, follow-ups and admin drafts here.'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business pulse</Text>
          <View style={styles.grid}>
            <MetricCard label="Open jobs" value={summary?.counts.openJobs} />
            <MetricCard
              label="Upcoming jobs"
              value={summary?.counts.upcomingJobs}
            />
          </View>
          <View style={styles.grid}>
            <MetricCard
              label="Completed appts"
              value={summary?.counts.completedAppointmentsToday}
            />
            <MetricCard
              label="My appointments"
              value={summary?.counts.myAppointments}
            />
          </View>
          <View style={styles.grid}>
            <MetricCard
              label="Upcoming appts"
              value={summary?.counts.upcomingAppointments}
            />
            <MetricCard label="Customers" value={summary?.counts.customers} />
          </View>
          <View style={styles.grid}>
            <MetricCard
              label="Technicians working"
              value={summary?.counts.techniciansWorking}
            />
            <MetricCard
              label="Available techs"
              value={summary?.counts.availableTechnicians}
            />
          </View>
          <View style={styles.grid}>
            <MetricCard
              label="Draft quotes"
              value={summary?.counts.draftQuotes}
            />
            <MetricCard
              label="Viewed quotes"
              value={summary?.counts.quotesViewedNotAccepted}
            />
          </View>
          <View style={styles.grid}>
            <MetricCard
              label="Accepted quotes"
              value={summary?.counts.acceptedQuotesNotConverted}
            />
            <MetricCard
              label="Tori messages"
              value={summary?.counts.aiMessages}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest notifications</Text>
          {summary?.notifications.length ? (
            summary.notifications.map((notification) => (
              <View key={notification.id} style={styles.listItem}>
                <Text style={styles.itemTitle}>{notification.title}</Text>
                <Text style={styles.itemMeta}>{notification.body}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No notifications yet.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function HeroMetric({
  label,
  value,
}: {
  label: string;
  value?: number | string;
}) {
  return (
    <View style={styles.heroMetric}>
      <Text style={styles.heroMetricValue}>{value ?? '-'}</Text>
      <Text style={styles.heroMetricLabel}>{label}</Text>
    </View>
  );
}

function DashboardRow({
  label,
  meta,
  onPress,
  tone,
  value,
}: {
  label: string;
  meta?: string;
  onPress?: () => void;
  tone?: 'warning';
  value: number | string;
}) {
  const content = (
    <>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      <View
        style={[
          styles.rowValuePill,
          tone === 'warning' && styles.rowValuePillWarning,
        ]}
      >
        <Text
          style={[
            styles.rowValue,
            tone === 'warning' && styles.rowValueWarning,
          ]}
        >
          {value}
        </Text>
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={`Open ${label}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.dashboardRow,
          pressed && styles.cardPressed,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.dashboardRow}>{content}</View>;
}

function MetricCard({
  label,
  onPress,
  tone,
  value,
}: {
  label: string;
  onPress?: () => void;
  tone?: 'warning';
  value?: number | string;
}) {
  const content = (
    <>
      <Text style={styles.value}>{value ?? '-'}</Text>
      <Text style={styles.label}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={`Open ${label}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          tone === 'warning' && styles.warningCard,
          pressed && styles.cardPressed,
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, tone === 'warning' && styles.warningCard]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { padding: 20, paddingBottom: 40 },
  greeting: { color: colours.muted, fontSize: 15 },
  headerCopy: { flex: 1, paddingRight: 14 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 14,
  },
  title: {
    color: colours.ink,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 4,
  },
  notificationButton: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 58,
    minWidth: 68,
    paddingHorizontal: 12,
  },
  notificationValue: {
    color: colours.primary,
    fontSize: 20,
    fontWeight: '900',
  },
  notificationLabel: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', gap: 10, marginTop: 10 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    minHeight: 96,
    padding: 14,
  },
  cardPressed: { opacity: 0.82 },
  warningCard: { borderColor: '#FDBA74' },
  value: { color: colours.ink, fontSize: 22, fontWeight: '800' },
  label: { color: colours.muted, fontSize: 12, lineHeight: 16, marginTop: 6 },
  dashboardRow: {
    alignItems: 'center',
    borderTopColor: colours.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 58,
    paddingVertical: 12,
  },
  heroMetric: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    padding: 14,
  },
  heroMetricLabel: {
    color: colours.muted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  heroMetricRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  heroMetricValue: { color: colours.ink, fontSize: 28, fontWeight: '900' },
  itemTitle: {
    color: colours.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  itemMeta: { color: colours.muted, lineHeight: 20, marginTop: 4 },
  moneyHero: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  moneyLabel: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  moneyValue: {
    color: colours.ink,
    fontSize: 30,
    fontWeight: '900',
    marginTop: 6,
  },
  previewCopy: { flex: 1 },
  previewItem: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    padding: 12,
  },
  previewTime: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    width: 82,
  },
  previewTitle: {
    color: colours.ink,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  rowCopy: { flex: 1 },
  rowLabel: { color: colours.ink, fontSize: 15, fontWeight: '800' },
  rowMeta: { color: colours.muted, lineHeight: 18, marginTop: 3 },
  rowValue: { color: colours.primary, fontWeight: '900' },
  rowValuePill: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    minWidth: 50,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rowValuePillWarning: { backgroundColor: '#FFF7ED' },
  rowValueWarning: { color: '#C2410C' },
  sectionEyebrow: {
    color: colours.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  sectionHeader: { marginBottom: 4 },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 24,
    padding: 18,
  },
  stateText: { color: colours.muted },
  errorCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 24,
    padding: 18,
  },
  errorTitle: { color: '#9F1239', fontSize: 16, fontWeight: '800' },
  errorBody: { color: '#9F1239', lineHeight: 20, marginTop: 8 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#9F1239',
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontWeight: '800' },
  summaryCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  todayCard: { marginTop: 22 },
  todayPreview: { marginTop: 2 },
  toriCard: {
    backgroundColor: '#F3E8FF',
    borderRadius: 20,
    marginTop: 20,
    padding: 20,
  },
  toriLabel: {
    color: colours.tori,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  toriTitle: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 10,
  },
  toriBody: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  section: { marginTop: 22 },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  listItem: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
    padding: 16,
  },
  emptyText: { color: colours.muted, marginTop: 10 },
});
