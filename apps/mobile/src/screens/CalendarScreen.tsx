import type {
  Appointment,
  AppointmentQuickAction,
  AppointmentStatus,
  CalendarViewMode,
  TeamMember,
} from '@tradieos/shared';
import {
  APPOINTMENT_STATUS_COLOURS,
  APPOINTMENT_STATUSES,
  getAppointmentQuickActions,
} from '@tradieos/shared';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  type GestureResponderEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  appointmentsRequest,
  membersRequest,
  transitionAppointmentRequest,
  updateAppointmentRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type {
  MainTabsParamList,
  RootStackParamList,
} from '../navigation/types';
import { colours } from '../theme';

type Props = BottomTabScreenProps<MainTabsParamList, 'Calendar'>;
type RootNavigator = {
  navigate(
    screen: keyof RootStackParamList,
    params?: RootStackParamList[keyof RootStackParamList],
  ): void;
};

const viewModes: CalendarViewMode[] = ['day', 'week', 'month', 'agenda'];
const AGENDA_RANGE_DAYS = 7;

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDayOfTargetMonth = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
  ).getDate();
  next.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return next;
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function dateRange(viewMode: CalendarViewMode, anchor: Date) {
  const start = startOfDay(anchor);
  if (viewMode === 'day') {
    return { end: addDays(start, 1), start };
  }
  if (viewMode === 'agenda') {
    return { end: addDays(start, AGENDA_RANGE_DAYS), start };
  }
  if (viewMode === 'week') {
    const day = start.getDay() || 7;
    const weekStart = addDays(start, 1 - day);
    return { end: addDays(weekStart, 7), start: weekStart };
  }
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  return {
    end: new Date(start.getFullYear(), start.getMonth() + 1, 1),
    start: monthStart,
  };
}

function navigatePeriod(
  viewMode: CalendarViewMode,
  anchor: Date,
  direction: -1 | 1,
) {
  if (viewMode === 'day') return addDays(anchor, direction);
  if (viewMode === 'week') return addDays(anchor, direction * 7);
  if (viewMode === 'month') return addMonths(anchor, direction);
  return addDays(anchor, direction * AGENDA_RANGE_DAYS);
}

function periodLabel(
  viewMode: CalendarViewMode,
  range: ReturnType<typeof dateRange>,
) {
  if (viewMode === 'day') return formatDate(range.start);
  if (viewMode === 'month') {
    return new Intl.DateTimeFormat('en-AU', {
      month: 'long',
      year: 'numeric',
    }).format(range.start);
  }
  return `${formatDate(range.start)} – ${formatDate(addDays(range.end, -1))}`;
}

function emptyMessage(viewMode: CalendarViewMode) {
  if (viewMode === 'month') return 'No appointments scheduled this month.';
  if (viewMode === 'week') return 'No appointments scheduled this week.';
  if (viewMode === 'agenda')
    return 'No appointments scheduled in this agenda range.';
  return 'No appointments scheduled for this day.';
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    year: 'numeric',
  }).format(value);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function statusIcon(status: AppointmentStatus) {
  if (status === 'COMPLETED') return '✓';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return '!';
  if (status === 'IN_PROGRESS') return '▶';
  if (status === 'ARRIVED') return '●';
  if (status === 'ON_THE_WAY') return '➜';
  if (status === 'CONFIRMED') return '★';
  if (status === 'RESCHEDULED') return '↻';
  return '•';
}

function appointmentAddress(appointment: Appointment) {
  return [
    appointment.addressLine1,
    appointment.addressLine2,
    appointment.suburb,
    appointment.state,
    appointment.postcode,
  ]
    .filter(Boolean)
    .join(', ');
}

function isSameCalendarDay(left: Date, right: Date) {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function selectedActionText(action: AppointmentQuickAction['id']) {
  if (action === 'start') return 'Starting appointment...';
  if (action === 'arrive') return 'Marking arrival...';
  if (action === 'complete') return 'Completing appointment...';
  if (action === 'reschedule') return 'Rescheduling appointment...';
  if (action === 'cancel') return 'Cancelling appointment...';
  return 'Updating appointment...';
}

export function CalendarScreen({ navigation }: Props) {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const rootNavigation = navigation.getParent() as RootNavigator | undefined;
  const [viewMode, setViewMode] = useState<CalendarViewMode>('day');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [jumpDraftDate, setJumpDraftDate] = useState(() => new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [technicianFilter, setTechnicianFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'ALL'>(
    'ALL',
  );
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showJumpPicker, setShowJumpPicker] = useState(false);
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [moreAppointment, setMoreAppointment] = useState<Appointment | null>(
    null,
  );

  const range = useMemo(
    () => dateRange(viewMode, anchorDate),
    [anchorDate, viewMode],
  );

  const loadCalendar = useCallback(
    async (shouldApply: () => boolean = () => true) => {
      if (!token) return;
      if (shouldApply()) setIsLoading(true);
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          dateFrom: range.start.toISOString(),
          dateTo: range.end.toISOString(),
          page: 1,
          pageSize: 100,
          sortBy: 'scheduledStart',
          sortOrder: 'asc',
        };
        if (technicianFilter === 'UNASSIGNED') {
          params.assignedUserId = 'unassigned';
        } else if (technicianFilter !== 'ALL') {
          params.assignedUserId = technicianFilter;
        }
        if (statusFilter !== 'ALL') params.status = statusFilter;
        if (search.trim()) params.search = search.trim();

        const [appointmentResponse, memberResponse] = await Promise.all([
          appointmentsRequest(token, params),
          membersRequest(token),
        ]);
        if (!shouldApply()) return;
        setAppointments(appointmentResponse.records);
        setMembers(
          memberResponse.filter((member) => member.status === 'ACTIVE'),
        );
      } catch (error) {
        if (shouldApply()) {
          showToast({
            message:
              error instanceof Error
                ? error.message
                : "We couldn't load the calendar.",
            tone: 'error',
          });
        }
      } finally {
        if (shouldApply()) setIsLoading(false);
      }
    },
    [
      range.end,
      range.start,
      search,
      showToast,
      statusFilter,
      technicianFilter,
      token,
    ],
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      void loadCalendar(() => isActive);
      return () => {
        isActive = false;
        setShowJumpPicker(false);
      };
    }, [loadCalendar]),
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    appointments.forEach((appointment) => {
      const key = startOfDay(
        new Date(appointment.scheduledStart),
      ).toISOString();
      map.set(key, [...(map.get(key) ?? []), appointment]);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [appointments]);

  const canFilterTechnicians = [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
  ].includes(user?.role ?? '');

  const technicianSummary = useMemo(() => {
    if (technicianFilter === 'ALL') return 'All technicians';
    if (technicianFilter === 'UNASSIGNED') return 'Unassigned';
    return (
      members.find((member) => member.userId === technicianFilter)?.name ??
      'Technician set'
    );
  }, [members, technicianFilter]);

  const filterSummary = `${technicianSummary} · ${
    statusFilter === 'ALL' ? 'All statuses' : label(statusFilter)
  }`;

  function toggleFilters() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFiltersOpen((current) => !current);
  }

  function openJumpPicker() {
    setJumpDraftDate(anchorDate);
    setShowJumpPicker(true);
  }

  function dismissJumpPicker() {
    setShowJumpPicker(false);
  }

  function applyJumpDate(nextDate: Date) {
    setAnchorDate(nextDate);
    setJumpDraftDate(nextDate);
    setShowJumpPicker(false);
  }

  function handleSwipeEnd(event: GestureResponderEvent) {
    if (showJumpPicker || swipeStartX === null) return;
    const delta = event.nativeEvent.pageX - swipeStartX;
    setSwipeStartX(null);
    if (Math.abs(delta) < 70) return;
    setAnchorDate((current) => addDays(current, delta > 0 ? -1 : 1));
  }

  function navigateToAppointment(appointment: Appointment) {
    const address = appointmentAddress(appointment);
    void Linking.openURL(
      `https://maps.apple.com/?q=${encodeURIComponent(address)}`,
    );
  }

  function viewAppointment(appointment: Appointment) {
    rootNavigation?.navigate('AppointmentDetails', {
      appointmentId: appointment.id,
    });
  }

  async function runWorkflowAction(
    appointment: Appointment,
    action: AppointmentQuickAction['id'],
  ) {
    if (!token || busyAction) return;

    if (action === 'viewDetails') {
      viewAppointment(appointment);
      return;
    }
    if (action === 'navigate') {
      navigateToAppointment(appointment);
      return;
    }
    if (action === 'call') {
      const phone = appointment.job.customer.phone;
      if (phone) void Linking.openURL(`tel:${phone}`);
      return;
    }
    if (action === 'reassign') {
      rootNavigation?.navigate('AppointmentReassign', {
        appointmentId: appointment.id,
      });
      return;
    }

    setBusyAction(selectedActionText(action));
    try {
      let response;
      if (action === 'reschedule') {
        const scheduledStart = addMinutes(
          new Date(appointment.scheduledStart),
          60,
        );
        const scheduledEnd = addMinutes(new Date(appointment.scheduledEnd), 60);
        response = await updateAppointmentRequest(token, appointment.id, {
          allowConflictOverride: user?.role === 'OWNER',
          appointmentType: appointment.appointmentType,
          assignedUserId: appointment.assignedUserId,
          estimatedDurationMinutes: appointment.estimatedDurationMinutes,
          jobId: appointment.jobId,
          notes: appointment.notes ?? undefined,
          scheduledEnd: scheduledEnd.toISOString(),
          scheduledStart: scheduledStart.toISOString(),
          status: 'RESCHEDULED',
          travelDistanceKm: appointment.travelDistanceKm,
          travelDurationMinutes: appointment.travelDurationMinutes,
        });
      } else if (action === 'cancel') {
        response = await transitionAppointmentRequest(
          token,
          appointment.id,
          'cancel',
        );
      } else {
        response = await transitionAppointmentRequest(
          token,
          appointment.id,
          action,
        );
      }

      setAppointments((current) =>
        current.map((item) =>
          item.id === appointment.id ? response.appointment : item,
        ),
      );
      showToast({
        message:
          action === 'reschedule'
            ? 'Appointment rescheduled.'
            : `${response.appointment.appointmentNumber} updated.`,
        tone: 'success',
      });
      await loadCalendar();
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't update this appointment.",
        tone: 'error',
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        onTouchEnd={handleSwipeEnd}
        onTouchStart={(event) => setSwipeStartX(event.nativeEvent.pageX)}
      >
        <Text style={styles.eyebrow}>CALENDAR</Text>
        <Text style={styles.title}>Appointments</Text>

        <View style={styles.toolbar}>
          <Pressable
            accessibilityLabel="Show today's appointments"
            accessibilityRole="button"
            onPress={() => setAnchorDate(new Date())}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>Today</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Previous date"
            accessibilityRole="button"
            onPress={() =>
              setAnchorDate((current) => navigatePeriod(viewMode, current, -1))
            }
            style={styles.navButton}
          >
            <Text style={styles.navText}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Next date"
            accessibilityRole="button"
            onPress={() =>
              setAnchorDate((current) => navigatePeriod(viewMode, current, 1))
            }
            style={styles.navButton}
          >
            <Text style={styles.navText}>›</Text>
          </Pressable>
        </View>

        <Text style={styles.rangeText}>{periodLabel(viewMode, range)}</Text>

        <Pressable
          accessibilityLabel="Jump to appointment date"
          accessibilityRole="button"
          onPress={openJumpPicker}
          style={styles.jumpButton}
        >
          <Text style={styles.jumpButtonText}>Jump to date</Text>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {viewModes.map((mode) => (
              <Chip
                active={viewMode === mode}
                key={mode}
                label={mode}
                onPress={() => setViewMode(mode)}
              />
            ))}
          </View>
        </ScrollView>

        <Pressable
          accessibilityLabel="Calendar filters"
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          onPress={toggleFilters}
          style={styles.filterHeader}
        >
          <View style={styles.filterHeaderRow}>
            <View style={styles.filterCopy}>
              <Text style={styles.filterTitle}>Filters</Text>
              <Text numberOfLines={2} style={styles.filterMeta}>
                {filterSummary}
              </Text>
            </View>
            <Text style={styles.filterChevron}>{filtersOpen ? '⌃' : '⌄'}</Text>
          </View>
        </Pressable>

        {filtersOpen ? (
          <View style={styles.filtersPanel}>
            <TextInput
              accessibilityLabel="Search appointments by customer or job"
              autoCapitalize="none"
              onChangeText={setSearch}
              placeholder="Search customer or job"
              placeholderTextColor={colours.muted}
              style={styles.searchInput}
              value={search}
            />

            {canFilterTechnicians ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  <Chip
                    active={technicianFilter === 'ALL'}
                    label="All technicians"
                    onPress={() => setTechnicianFilter('ALL')}
                  />
                  <Chip
                    active={technicianFilter === 'UNASSIGNED'}
                    label="Unassigned"
                    onPress={() => setTechnicianFilter('UNASSIGNED')}
                  />
                  {members.map((member) => (
                    <Chip
                      active={technicianFilter === member.userId}
                      key={member.id}
                      label={member.name}
                      onPress={() =>
                        setTechnicianFilter(member.userId ?? 'ALL')
                      }
                    />
                  ))}
                </View>
              </ScrollView>
            ) : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                <Chip
                  active={statusFilter === 'ALL'}
                  label="All statuses"
                  onPress={() => setStatusFilter('ALL')}
                />
                {APPOINTMENT_STATUSES.map((status) => (
                  <Chip
                    active={statusFilter === status}
                    key={status}
                    label={label(status)}
                    onPress={() => setStatusFilter(status)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.meta}>Loading calendar...</Text>
          </View>
        ) : null}

        {viewMode === 'day' && isSameCalendarDay(anchorDate, new Date()) ? (
          <CurrentTimeIndicator />
        ) : null}

        {appointments.length === 0 && !isLoading ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>{emptyMessage(viewMode)}</Text>
            <Text style={styles.meta}>
              Try another date, technician or status filter.
            </Text>
          </View>
        ) : null}

        {grouped.map(([day, dayItems]) => (
          <View key={day} style={styles.daySection}>
            <Text style={styles.sectionTitle}>{formatDate(new Date(day))}</Text>
            {dayItems.map((appointment) => (
              <AppointmentCard
                appointment={appointment}
                busy={Boolean(busyAction)}
                key={appointment.id}
                onAction={(action) =>
                  void runWorkflowAction(appointment, action.id)
                }
                onMore={() => setMoreAppointment(appointment)}
                onPress={() => viewAppointment(appointment)}
                role={user?.role}
                userId={user?.id}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <Pressable
        accessibilityLabel="Create new appointment"
        accessibilityRole="button"
        onPress={() => rootNavigation?.navigate('AppointmentForm')}
        style={styles.fab}
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <JumpDateModal
        draftDate={jumpDraftDate}
        onApply={applyJumpDate}
        onChangeDraft={setJumpDraftDate}
        onDismiss={dismissJumpPicker}
        visible={showJumpPicker}
      />

      <AppointmentMoreMenu
        appointment={moreAppointment}
        busy={Boolean(busyAction)}
        onAction={(appointment, action) => {
          setMoreAppointment(null);
          void runWorkflowAction(appointment, action.id);
        }}
        onDismiss={() => setMoreAppointment(null)}
        role={user?.role}
        userId={user?.id}
      />

      <BlockingLoader text={busyAction} />
    </SafeAreaView>
  );
}

function JumpDateModal({
  draftDate,
  onApply,
  onChangeDraft,
  onDismiss,
  visible,
}: {
  draftDate: Date;
  onApply(value: Date): void;
  onChangeDraft(value: Date): void;
  onDismiss(): void;
  visible: boolean;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Dismiss date picker"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.modalBackdrop}
      >
        <Pressable
          accessibilityLabel="Date picker"
          onPress={(event) => event.stopPropagation()}
          style={styles.datePickerCard}
        >
          <Text style={styles.modalTitle}>Jump to date</Text>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            mode="date"
            onChange={(event, selectedDate) => {
              if (Platform.OS === 'android') {
                if (event.type === 'set' && selectedDate) {
                  onApply(selectedDate);
                } else {
                  onDismiss();
                }
                return;
              }
              if (selectedDate) onChangeDraft(selectedDate);
            }}
            value={draftDate}
          />
          {Platform.OS === 'ios' ? (
            <Pressable
              accessibilityLabel="Done selecting date"
              accessibilityRole="button"
              onPress={() => onApply(draftDate)}
              style={styles.doneButton}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BlockingLoader({ text }: { text: string | null }) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(text)}>
      <View style={styles.loaderBackdrop}>
        <View style={styles.loaderCard}>
          <ActivityIndicator color={colours.primary} />
          <Text style={styles.loaderText}>{text}</Text>
        </View>
      </View>
    </Modal>
  );
}

function CurrentTimeIndicator() {
  return (
    <View style={styles.nowRow}>
      <View style={styles.nowDot} />
      <View style={styles.nowLine} />
      <Text style={styles.nowText}>Current time</Text>
    </View>
  );
}

function AppointmentCard({
  appointment,
  busy,
  onAction,
  onMore,
  onPress,
  role,
  userId,
}: {
  appointment: Appointment;
  busy: boolean;
  onAction(action: AppointmentQuickAction): void;
  onMore(): void;
  onPress(): void;
  role?: string;
  userId?: string;
}) {
  const statusColour = APPOINTMENT_STATUS_COLOURS[appointment.status];
  const address = appointmentAddress(appointment);
  const actions = getAppointmentQuickActions({
    hasAddress: Boolean(address),
    hasPhone: Boolean(appointment.job.customer.phone?.trim()),
    isAssignedUser: appointment.assignedUserId === userId,
    role: role as Parameters<typeof getAppointmentQuickActions>[0]['role'],
    status: appointment.status,
  });
  const workflowAction = actions.find((action) => action.kind === 'workflow');
  const contactAction = actions.find((action) =>
    ['contact', 'navigation'].includes(action.kind),
  );
  const viewDetailsAction = actions.find(
    (action) => action.id === 'viewDetails',
  );
  const primaryActions = [contactAction, workflowAction]
    .filter((action): action is AppointmentQuickAction => Boolean(action))
    .slice(0, 2);
  const visibleActions =
    primaryActions.length > 0
      ? primaryActions
      : viewDetailsAction
        ? [viewDetailsAction]
        : [];
  const hasMore = actions.some(
    (action) => !visibleActions.some((visible) => visible.id === action.id),
  );

  return (
    <Pressable
      accessibilityLabel={`${appointment.job.title}, ${label(appointment.status)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.eventCard, { borderColor: statusColour.border }]}
    >
      <View style={styles.eventHeader}>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: statusColour.background },
          ]}
        >
          <Text style={[styles.statusText, { color: statusColour.text }]}>
            {statusIcon(appointment.status)} {label(appointment.status)}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
      <Text style={styles.eventTime}>
        {formatTime(appointment.scheduledStart)} –{' '}
        {formatTime(appointment.scheduledEnd)}
      </Text>
      <Text style={styles.eventTitle}>{appointment.job.title}</Text>
      <Text style={styles.meta}>
        {appointment.job.customer.companyName ??
          appointment.job.customer.displayName}
      </Text>
      <Text style={styles.meta}>
        {appointment.assignedUser
          ? `${appointment.assignedUser.firstName} ${appointment.assignedUser.lastName}`
          : 'Unassigned'}
      </Text>
      {appointment.suburb ? (
        <Text style={styles.meta}>{appointment.suburb}</Text>
      ) : null}
      <View style={styles.cardActions}>
        {visibleActions.map((action) => (
          <MiniAction
            disabled={busy}
            key={action.id}
            label={action.label}
            onPress={() => onAction(action)}
          />
        ))}
        {hasMore ? (
          <MiniAction disabled={busy} label="More" onPress={onMore} />
        ) : null}
      </View>
    </Pressable>
  );
}

function AppointmentMoreMenu({
  appointment,
  busy,
  onAction,
  onDismiss,
  role,
  userId,
}: {
  appointment: Appointment | null;
  busy: boolean;
  onAction(appointment: Appointment, action: AppointmentQuickAction): void;
  onDismiss(): void;
  role?: string;
  userId?: string;
}) {
  if (!appointment) return null;
  const address = appointmentAddress(appointment);
  const actions = getAppointmentQuickActions({
    hasAddress: Boolean(address),
    hasPhone: Boolean(appointment.job.customer.phone?.trim()),
    isAssignedUser: appointment.assignedUserId === userId,
    role: role as Parameters<typeof getAppointmentQuickActions>[0]['role'],
    status: appointment.status,
  });

  return (
    <Modal animationType="fade" transparent visible>
      <Pressable
        accessibilityLabel="Close appointment actions"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.modalBackdrop}
      >
        <Pressable
          accessibilityLabel="Appointment actions"
          onPress={(event) => event.stopPropagation()}
          style={styles.moreCard}
        >
          <Text style={styles.modalTitle}>Appointment actions</Text>
          {actions.map((action) => (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              key={action.id}
              onPress={() => onAction(appointment, action)}
              style={styles.moreAction}
            >
              <Text style={styles.moreActionText}>{action.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MiniAction({
  disabled,
  label: text,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={text}
      accessibilityRole="button"
      disabled={disabled}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={[styles.miniAction, disabled && styles.disabledAction]}
    >
      <Text style={styles.miniActionText}>{text}</Text>
    </Pressable>
  );
}

function Chip({
  active,
  label: text,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  chevron: { color: colours.muted, fontSize: 24, fontWeight: '900' },
  chip: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colours.primary },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 14, paddingVertical: 2 },
  chipText: {
    color: colours.muted,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  chipTextActive: { color: '#FFFFFF' },
  container: { padding: 24, paddingBottom: 124 },
  datePickerCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    maxWidth: 420,
    padding: 16,
    width: '92%',
  },
  daySection: { marginTop: 20 },
  disabledAction: { opacity: 0.55 },
  doneButton: {
    alignSelf: 'flex-start',
    backgroundColor: colours.primary,
    borderRadius: 999,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  doneText: { color: '#FFFFFF', fontWeight: '900' },
  emptyTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  eventCard: {
    backgroundColor: colours.card,
    borderLeftWidth: 5,
    borderRadius: 18,
    marginTop: 10,
    padding: 16,
  },
  eventHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eventTime: { color: colours.primary, fontWeight: '900', marginTop: 8 },
  eventTitle: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 6,
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  fab: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 32,
    bottom: 24,
    elevation: 6,
    height: 64,
    justifyContent: 'center',
    position: 'absolute',
    right: 24,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    width: 64,
  },
  fabText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 38,
  },
  filterChevron: { color: colours.primary, fontSize: 24, fontWeight: '900' },
  filterCopy: { flex: 1, paddingRight: 12 },
  filterHeader: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  filterHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  filterMeta: { color: colours.muted, marginTop: 4 },
  filterTitle: { color: colours.ink, fontSize: 17, fontWeight: '900' },
  filtersPanel: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  jumpButton: {
    alignSelf: 'flex-start',
    backgroundColor: colours.primary,
    borderRadius: 14,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  jumpButtonText: { color: '#FFFFFF', fontWeight: '900' },
  loaderBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loaderCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 12,
    padding: 22,
    width: '86%',
  },
  loaderText: { color: colours.ink, fontWeight: '900', textAlign: 'center' },
  meta: { color: colours.muted, lineHeight: 20, marginTop: 4 },
  miniAction: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  miniActionText: { color: colours.primary, fontWeight: '900' },
  moreAction: {
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  moreActionText: { color: colours.primary, fontWeight: '900' },
  moreCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    maxWidth: 420,
    padding: 16,
    width: '92%',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalTitle: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 10,
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  navText: { color: colours.ink, fontSize: 24, fontWeight: '900' },
  nowDot: {
    backgroundColor: '#EF4444',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  nowLine: { backgroundColor: '#EF4444', flex: 1, height: 2 },
  nowRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 18 },
  nowText: { color: '#EF4444', fontSize: 12, fontWeight: '900' },
  primaryButton: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '900' },
  rangeText: { color: colours.muted, fontWeight: '700', marginTop: 12 },
  safeArea: { backgroundColor: colours.background, flex: 1 },
  searchInput: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colours.ink,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    marginTop: 18,
    padding: 18,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: { fontSize: 12, fontWeight: '900' },
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
  toolbar: { flexDirection: 'row', gap: 8, marginTop: 18 },
});
