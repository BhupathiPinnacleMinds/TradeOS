import type {
  AppointmentLocationSource,
  AppointmentPayload,
  AppointmentType,
  AustralianState,
  Customer,
  CustomerPayload,
  CustomerSite,
  Job,
  JobPayload,
  TeamMember,
} from '@tradieos/shared';
import {
  APPOINTMENT_LOCATION_SOURCES,
  AUSTRALIAN_STATES,
  createUnsavedChangesNavigationGuard,
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessDate,
  formatBusinessTime,
  formatBusinessTimeRange,
  formatBusinessTimezoneAbbreviation,
  getBusinessDateParts,
  normaliseBusinessTimezone,
  zonedTimeToUtc,
} from '@tradieos/shared';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CommonActions, usePreventRemove } from '@react-navigation/native';
import type { NavigationAction } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createAppointmentRequest,
  createCustomerRequest,
  createJobRequest,
  customerDetailRequest,
  customersRequest,
  friendlyAppointmentCreateError,
  jobDetailRequest,
  membersRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { useToast } from '../components/ToastProvider';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentForm'>;

type ResolvedLocation = {
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: AustralianState | '';
  postcode: string;
  accessInstructions: string;
};

const appointmentTypes: AppointmentType[] = [
  'INSPECTION',
  'INSTALLATION',
  'MAINTENANCE',
  'RETURN_VISIT',
  'EMERGENCY_VISIT',
];
const durations = [30, 60, 90, 120, 180, 240];
const locationSourceOptions: Array<{
  label: string;
  value: AppointmentLocationSource;
}> = [
  { label: 'Customer service site', value: 'CUSTOMER_SITE' },
  { label: 'Customer default address', value: 'CUSTOMER_DEFAULT' },
  { label: 'Enter different address', value: 'MANUAL' },
];

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function nextStart(timezone = DEFAULT_BUSINESS_TIMEZONE) {
  const parts = getBusinessDateParts(new Date(), timezone);
  const nextHour = parts.hour + 1;
  if (nextHour < 7) {
    return zonedTimeToUtc(
      {
        day: parts.day,
        hour: 7,
        minute: 30,
        month: parts.month,
        year: parts.year,
      },
      timezone,
    );
  }
  if (nextHour >= 17) {
    return zonedTimeToUtc(
      {
        day: parts.day + 1,
        hour: 7,
        minute: 30,
        month: parts.month,
        year: parts.year,
      },
      timezone,
    );
  }
  return zonedTimeToUtc(
    {
      day: parts.day,
      hour: nextHour,
      month: parts.month,
      year: parts.year,
    },
    timezone,
  );
}

function initialStart(
  selectedDate?: string,
  timezone = DEFAULT_BUSINESS_TIMEZONE,
) {
  if (!selectedDate) return nextStart(timezone);
  const date = new Date(selectedDate);
  if (Number.isNaN(date.getTime())) return nextStart(timezone);
  return date;
}

function formatDate(value: Date, timezone: string = DEFAULT_BUSINESS_TIMEZONE) {
  return formatBusinessDate(value, timezone);
}

function formatTime(value: Date, timezone: string = DEFAULT_BUSINESS_TIMEZONE) {
  return formatBusinessTime(value, timezone);
}

function formatLocation(location: ResolvedLocation) {
  return [
    location.addressLine1,
    location.addressLine2,
    location.suburb,
    location.state,
    location.postcode,
  ]
    .filter(Boolean)
    .join(', ');
}

function upsertCustomer(records: Customer[], customer: Customer) {
  const existingIndex = records.findIndex(
    (record) => record.id === customer.id,
  );
  if (existingIndex === -1) return [customer, ...records];
  return records.map((record, index) =>
    index === existingIndex ? customer : record,
  );
}

function logAppointmentFormNavigation(
  event: string,
  details: Record<string, unknown> = {},
) {
  console.info(`[AppointmentForm] ${event}`, details);
}

export function AppointmentFormScreen({ navigation, route }: Props) {
  const {
    customerId,
    customerSiteId,
    jobId,
    selectedDate,
    siteId,
    technicianId,
  } = route.params ?? {};
  const preferredSiteId = customerSiteId ?? siteId;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const businessTimezone = normaliseBusinessTimezone(user?.business.timezone);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(
    customerId ?? '',
  );
  const [selectedSiteId, setSelectedSiteId] = useState(preferredSiteId ?? '');
  const [selectedJobId, setSelectedJobId] = useState(jobId ?? '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [locationSource, setLocationSource] =
    useState<AppointmentLocationSource>('MANUAL');
  const [useQuickCustomer, setUseQuickCustomer] = useState(false);
  const [useQuickJob, setUseQuickJob] = useState(!jobId);
  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [quickCustomerPhone, setQuickCustomerPhone] = useState('');
  const [quickJobTitle, setQuickJobTitle] = useState('');
  const [manualAddressLine1, setManualAddressLine1] = useState('');
  const [manualAddressLine2, setManualAddressLine2] = useState('');
  const [manualSuburb, setManualSuburb] = useState('');
  const [manualState, setManualState] = useState<AustralianState | ''>('NSW');
  const [manualPostcode, setManualPostcode] = useState('');
  const [manualAccessInstructions, setManualAccessInstructions] = useState('');
  const [saveAddressAsSite, setSaveAddressAsSite] = useState(false);
  const [assignedUserId, setAssignedUserId] = useState<string | null>(
    technicianId ?? null,
  );
  const [appointmentType, setAppointmentType] =
    useState<AppointmentType>('INSPECTION');
  const [startAt, setStartAt] = useState(() =>
    initialStart(selectedDate, businessTimezone),
  );
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [notes, setNotes] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const cleanSnapshotRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const hasSavedRef = useRef(false);
  const mountedRef = useRef(true);
  const navigationRef = useRef(navigation);
  const mainPressAttemptRef = useRef(0);
  const guardRef = useRef(
    createUnsavedChangesNavigationGuard<NavigationAction>({
      dispatch(action) {
        navigationRef.current.dispatch(action);
      },
      getHasSaved() {
        return hasSavedRef.current;
      },
      getIsDirty() {
        return isDirtyRef.current;
      },
      getIsMounted() {
        return mountedRef.current;
      },
      getIsSaving() {
        return isSavingRef.current;
      },
      onBeforeConfirmation() {
        logAppointmentFormNavigation('APPOINTMENT_FORM_CONFIRMATION_OPEN');
        Keyboard.dismiss();
      },
      requestConfirmation({ leave, stay }) {
        Alert.alert(
          'Leave appointment?',
          'You have unsaved appointment details. Leave without saving?',
          [
            {
              onPress() {
                logAppointmentFormNavigation('APPOINTMENT_FORM_STAY_SELECTED');
                stay();
                logAppointmentFormNavigation(
                  'APPOINTMENT_FORM_PENDING_ACTION_CLEARED',
                );
                logAppointmentFormNavigation(
                  'APPOINTMENT_FORM_CONFIRMATION_RESET',
                );
              },
              style: 'cancel',
              text: 'Stay',
            },
            {
              onPress() {
                logAppointmentFormNavigation('APPOINTMENT_FORM_LEAVE_SELECTED');
                leave();
              },
              style: 'destructive',
              text: 'Leave',
            },
          ],
          {
            onDismiss() {
              logAppointmentFormNavigation(
                'APPOINTMENT_FORM_CONFIRMATION_DISMISSED',
              );
              stay();
            },
          },
        );
      },
    }),
  );

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId),
    [customers, selectedCustomerId],
  );
  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId, sites],
  );
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId),
    [jobs, selectedJobId],
  );
  const filteredCustomers = useMemo(() => {
    const search = customerSearch.trim().toLowerCase();
    if (!search) return customers.slice(0, 5);
    return customers
      .filter((customer) =>
        [
          customer.displayName,
          customer.companyName,
          customer.email,
          customer.phone,
          customer.suburb,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search),
      )
      .slice(0, 8);
  }, [customerSearch, customers]);
  const resolvedLocation = useMemo(
    () => getResolvedLocation(),
    [
      locationSource,
      manualAccessInstructions,
      manualAddressLine1,
      manualAddressLine2,
      manualPostcode,
      manualState,
      manualSuburb,
      selectedCustomer,
      selectedSite,
    ],
  );
  const formSnapshot = useMemo(
    () =>
      JSON.stringify({
        appointmentType,
        assignedUserId,
        customerSearch,
        durationMinutes,
        locationSource,
        manualAccessInstructions,
        manualAddressLine1,
        manualAddressLine2,
        manualPostcode,
        manualState,
        manualSuburb,
        notes,
        quickCustomerName,
        quickCustomerPhone,
        quickJobTitle,
        saveAddressAsSite,
        selectedCustomerId,
        selectedJobId,
        selectedSiteId,
        startAt: startAt.toISOString(),
        useQuickCustomer,
        useQuickJob,
      }),
    [
      appointmentType,
      assignedUserId,
      customerSearch,
      durationMinutes,
      locationSource,
      manualAccessInstructions,
      manualAddressLine1,
      manualAddressLine2,
      manualPostcode,
      manualState,
      manualSuburb,
      notes,
      quickCustomerName,
      quickCustomerPhone,
      quickJobTitle,
      saveAddressAsSite,
      selectedCustomerId,
      selectedJobId,
      selectedSiteId,
      startAt,
      useQuickCustomer,
      useQuickJob,
    ],
  );

  useEffect(() => {
    navigationRef.current = navigation;
  }, [navigation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      logAppointmentFormNavigation('APPOINTMENT_FORM_UNMOUNTED', {
        routeKey: route.key,
      });
      mountedRef.current = false;
      guardRef.current.cleanup();
    };
  }, [route.key]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    hasSavedRef.current = hasSaved;
  }, [hasSaved]);

  useEffect(() => {
    if (!isLoading && cleanSnapshotRef.current === null) {
      cleanSnapshotRef.current = formSnapshot;
    }
  }, [formSnapshot, isLoading]);

  useEffect(() => {
    isDirtyRef.current =
      !isLoading &&
      !hasSaved &&
      cleanSnapshotRef.current !== null &&
      cleanSnapshotRef.current !== formSnapshot;
    logAppointmentFormNavigation('APPOINTMENT_FORM_DIRTY', {
      dirty: isDirtyRef.current,
    });
    setIsFormDirty(isDirtyRef.current);
  }, [formSnapshot, hasSaved, isLoading]);

  const requestMainBack = useCallback(() => {
    mainPressAttemptRef.current += 1;
    const isRepeatMainPress = mainPressAttemptRef.current > 1;
    const canGoBack = navigation.canGoBack();
    logAppointmentFormNavigation('APPOINTMENT_FORM_MAIN_PRESS', {
      canGoBack,
      dirty: isDirtyRef.current,
      routeKey: route.key,
      routeName: route.name,
    });
    if (isRepeatMainPress && isDirtyRef.current) {
      logAppointmentFormNavigation('APPOINTMENT_FORM_SECOND_MAIN_PRESS', {
        routeKey: route.key,
      });
    }

    Keyboard.dismiss();

    if (canGoBack) {
      navigation.goBack();
      return;
    }

    const fallbackAction = CommonActions.navigate('Main');
    if (isDirtyRef.current && !isSavingRef.current && !hasSavedRef.current) {
      guardRef.current.handlePreventedAction(fallbackAction);
      logAppointmentFormNavigation('APPOINTMENT_FORM_ACTION_STORED', {
        routeKey: route.key,
      });
      return;
    }
    navigation.dispatch(fallbackAction);
  }, [navigation, route.key, route.name]);

  useEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => (
        <ScreenBackButton
          accessibilityLabel="Back to Main"
          label="Main"
          onPress={requestMainBack}
        />
      ),
      title: 'New appointment',
    });
  }, [navigation, requestMainBack]);

  usePreventRemove(isFormDirty && !hasSaved && !isSaving, ({ data }) => {
    logAppointmentFormNavigation('APPOINTMENT_FORM_GUARD_INTERCEPTED', {
      dirty: isDirtyRef.current,
      routeKey: route.key,
    });
    guardRef.current.handlePreventedAction(data.action as NavigationAction);
    logAppointmentFormNavigation('APPOINTMENT_FORM_ACTION_STORED', {
      routeKey: route.key,
    });
  });

  useEffect(() => {
    if (!token) return;
    const authToken = token;
    let mounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const [customerResponse, teamResponse] = await Promise.all([
          customersRequest(authToken, {
            page: 1,
            pageSize: 100,
            sortBy: 'displayName',
          }),
          membersRequest(authToken),
        ]);
        if (!mounted) return;
        setCustomers(customerResponse.records);
        setMembers(teamResponse.filter((member) => member.status === 'ACTIVE'));
        if (customerId) {
          try {
            await loadCustomer(
              authToken,
              customerId,
              mounted,
              preferredSiteId,
              Boolean(jobId),
            );
            if (!mounted) return;
            setSelectedCustomerId(customerId);
          } catch {
            if (!mounted) return;
            clearCustomerSelection();
            showToast({
              message:
                "We couldn't load that customer. Search and select a customer.",
              tone: 'error',
            });
          }
        }
        if (jobId) {
          const jobResponse = await jobDetailRequest(authToken, jobId);
          if (!mounted) return;
          setSelectedJobId(jobResponse.job.id);
          setUseQuickJob(false);
          setQuickJobTitle(jobResponse.job.title);
          setStartAt(new Date(jobResponse.job.scheduledStart));
          setDurationMinutes(jobResponse.job.estimatedDurationMinutes ?? 120);
          setAssignedUserId(jobResponse.job.assignedToUserId);
        }
      } catch (error) {
        showToast({
          message:
            error instanceof Error
              ? error.message
              : "We couldn't prepare the appointment form.",
          tone: 'error',
        });
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [customerId, jobId, preferredSiteId, showToast, token]);

  async function loadCustomer(
    authToken: string,
    nextCustomerId: string,
    mounted = true,
    preferredSiteId?: string,
    shouldSelectFirstJob = false,
  ) {
    const detail = await customerDetailRequest(authToken, nextCustomerId);
    if (!mounted) return;
    const activeSites = detail.customer.sites.filter(
      (site) => !site.isArchived,
    );
    setCustomers((current) => upsertCustomer(current, detail.customer));
    setSites(activeSites);
    setJobs(detail.jobs);
    const nextSiteId = preferredSiteId
      ? (activeSites.find((site) => site.id === preferredSiteId)?.id ?? '')
      : '';
    setSelectedSiteId(nextSiteId);
    setLocationSource(nextSiteId ? 'CUSTOMER_SITE' : 'CUSTOMER_DEFAULT');
    if (shouldSelectFirstJob && !jobId && detail.jobs[0]) {
      setSelectedJobId(detail.jobs[0].id);
      setQuickJobTitle(detail.jobs[0].title);
      setUseQuickJob(false);
    }
  }

  function clearCustomerSelection() {
    setSelectedCustomerId('');
    setSelectedSiteId('');
    setSites([]);
    setJobs([]);
    setSelectedJobId('');
    setQuickJobTitle('');
    setUseQuickJob(true);
    setLocationSource('MANUAL');
    setManualAddressLine1('');
    setManualAddressLine2('');
    setManualSuburb('');
    setManualPostcode('');
    setManualAccessInstructions('');
  }

  async function selectCustomer(nextCustomerId: string) {
    if (!token) return;
    setSelectedCustomerId(nextCustomerId);
    setSelectedSiteId('');
    setSites([]);
    setJobs([]);
    setSelectedJobId('');
    setQuickJobTitle('');
    setUseQuickJob(true);
    setLocationSource('CUSTOMER_DEFAULT');
    await loadCustomer(token, nextCustomerId);
  }

  function getResolvedLocation(): ResolvedLocation {
    if (locationSource === 'CUSTOMER_SITE' && selectedSite) {
      return {
        accessInstructions: selectedSite.accessInstructions ?? '',
        addressLine1: selectedSite.addressLine1,
        addressLine2: selectedSite.addressLine2 ?? '',
        postcode: selectedSite.postcode,
        state: selectedSite.state,
        suburb: selectedSite.suburb,
      };
    }

    if (locationSource === 'CUSTOMER_DEFAULT' && selectedCustomer) {
      return {
        accessInstructions: '',
        addressLine1: selectedCustomer.addressLine1 ?? '',
        addressLine2: selectedCustomer.addressLine2 ?? '',
        postcode: selectedCustomer.postcode ?? '',
        state: selectedCustomer.state ?? '',
        suburb: selectedCustomer.suburb ?? '',
      };
    }

    return {
      accessInstructions: manualAccessInstructions,
      addressLine1: manualAddressLine1,
      addressLine2: manualAddressLine2,
      postcode: manualPostcode,
      state: manualState,
      suburb: manualSuburb,
    };
  }

  function validateLocation() {
    if (locationSource === 'CUSTOMER_SITE' && !selectedSite) {
      showToast({ message: 'Choose a customer service site.', tone: 'error' });
      return false;
    }
    if (
      !resolvedLocation.addressLine1.trim() ||
      !resolvedLocation.suburb.trim() ||
      !resolvedLocation.state ||
      !resolvedLocation.postcode.trim()
    ) {
      showToast({
        message:
          'Appointment location needs address, suburb, state and postcode.',
        tone: 'error',
      });
      return false;
    }
    if (!AUSTRALIAN_STATES.includes(resolvedLocation.state)) {
      showToast({ message: 'Choose a valid Australian state.', tone: 'error' });
      return false;
    }
    if (!/^\d{4}$/.test(resolvedLocation.postcode.trim())) {
      showToast({
        message: 'Postcode must be exactly 4 digits.',
        tone: 'error',
      });
      return false;
    }
    return true;
  }

  function onDateChange(date?: Date) {
    if (!date) return;
    setStartAt((current) => {
      const next = new Date(current);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      return next;
    });
  }

  function onTimeChange(date?: Date) {
    if (!date) return;
    setStartAt((current) => {
      const next = new Date(current);
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    });
  }

  async function save() {
    if (!token || isSaving) return;
    if (!validateLocation()) return;
    if (!selectedCustomerId && !useQuickCustomer) {
      showToast({ message: 'Choose or create a customer.', tone: 'error' });
      return;
    }
    if (useQuickCustomer && !quickCustomerName.trim()) {
      showToast({ message: 'Enter a quick customer name.', tone: 'error' });
      return;
    }
    if (useQuickJob && !quickJobTitle.trim()) {
      showToast({ message: 'Enter a job title.', tone: 'error' });
      return;
    }
    if (!selectedJobId && !useQuickJob) {
      showToast({ message: 'Choose or create a job.', tone: 'error' });
      return;
    }

    setIsSaving(true);
    try {
      let finalCustomerId = selectedCustomerId;
      if (useQuickCustomer) {
        const customerPayload: CustomerPayload = {
          addressLine1: resolvedLocation.addressLine1,
          addressLine2: resolvedLocation.addressLine2 || undefined,
          allowDuplicate: true,
          contactPreference: 'ANY',
          customerType: 'RESIDENTIAL',
          firstName: quickCustomerName.trim(),
          phone: quickCustomerPhone.trim(),
          postcode: resolvedLocation.postcode,
          state: resolvedLocation.state as AustralianState,
          suburb: resolvedLocation.suburb,
        };
        const customerResponse = await createCustomerRequest(
          token,
          customerPayload,
        );
        finalCustomerId = customerResponse.customer.id;
      }

      let finalJobId = selectedJobId;
      if (useQuickJob) {
        const jobPayload: JobPayload = {
          accessInstructions:
            resolvedLocation.accessInstructions.trim() || undefined,
          addressLine1: resolvedLocation.addressLine1,
          addressLine2: resolvedLocation.addressLine2 || undefined,
          assignedToUserId: assignedUserId,
          customerId: finalCustomerId,
          estimatedDurationMinutes: durationMinutes,
          postcode: resolvedLocation.postcode,
          priority: 'NORMAL',
          scheduledEnd: addMinutes(startAt, durationMinutes).toISOString(),
          scheduledStart: startAt.toISOString(),
          state: resolvedLocation.state as AustralianState,
          status: 'SCHEDULED',
          suburb: resolvedLocation.suburb,
          title: quickJobTitle.trim(),
        };
        const jobResponse = await createJobRequest(token, jobPayload);
        finalJobId = jobResponse.job.id;
      }

      const payload: AppointmentPayload = {
        accessInstructions:
          resolvedLocation.accessInstructions.trim() || undefined,
        addressLine1: resolvedLocation.addressLine1,
        addressLine2: resolvedLocation.addressLine2.trim() || undefined,
        appointmentType,
        assignedUserId,
        customerSiteId:
          locationSource === 'CUSTOMER_SITE' ? selectedSiteId : undefined,
        estimatedDurationMinutes: durationMinutes,
        jobId: finalJobId,
        locationSource,
        notes: notes.trim() || undefined,
        postcode: resolvedLocation.postcode,
        saveAddressAsCustomerSite:
          locationSource === 'MANUAL' ? saveAddressAsSite : false,
        scheduledEnd: addMinutes(startAt, durationMinutes).toISOString(),
        scheduledStart: startAt.toISOString(),
        state: resolvedLocation.state,
        status: 'SCHEDULED',
        suburb: resolvedLocation.suburb,
      };
      const response = await createAppointmentRequest(token, payload);
      hasSavedRef.current = true;
      setHasSaved(true);
      showToast({
        message: `${response.appointment.appointmentNumber} created.`,
        tone: 'success',
      });
      navigation.replace('AppointmentDetails', {
        appointmentId: response.appointment.id,
      });
    } catch (error) {
      showToast({
        message: friendlyAppointmentCreateError(error),
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Preparing appointment form...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={keyboardAvoidingBehavior}
      style={styles.page}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>APPOINTMENT</Text>
        <Text style={styles.title}>New appointment</Text>
        <Text style={styles.subtitle}>
          Schedule a real visit from the existing appointment engine.
        </Text>

        <Section title="1. Customer">
          <Toggle
            active={useQuickCustomer}
            label="Quick-create customer"
            onPress={() => setUseQuickCustomer((current) => !current)}
          />
          {useQuickCustomer ? (
            <>
              <Field
                label="Customer name"
                onChangeText={setQuickCustomerName}
                value={quickCustomerName}
              />
              <Field
                keyboardType="phone-pad"
                label="Phone"
                onChangeText={setQuickCustomerPhone}
                value={quickCustomerPhone}
              />
            </>
          ) : (
            <>
              <Field
                label="Search and select a customer"
                onChangeText={setCustomerSearch}
                value={customerSearch}
              />
              {selectedCustomer ? (
                <View style={styles.summaryBox}>
                  <Text style={styles.label}>Selected customer</Text>
                  <Text style={styles.summaryTitle}>
                    {selectedCustomer.displayName}
                  </Text>
                  <Text style={styles.muted}>
                    {selectedCustomer.phone ?? 'No phone'} ·{' '}
                    {selectedCustomer.suburb ?? 'No suburb recorded'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={clearCustomerSelection}
                    style={styles.clearButton}
                  >
                    <Text style={styles.clearButtonText}>Clear customer</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Text style={styles.muted}>
                    {customerSearch.trim()
                      ? 'Search results'
                      : 'Recent customers'}
                  </Text>
                  <HorizontalPicker
                    options={filteredCustomers.map((customer) => ({
                      label:
                        customer.companyName ??
                        `${customer.displayName}${
                          customer.phone ? ` · ${customer.phone}` : ''
                        }`,
                      value: customer.id,
                    }))}
                    selected={selectedCustomerId}
                    onSelect={(value) => void selectCustomer(value)}
                  />
                </>
              )}
            </>
          )}
        </Section>

        <Section title="2. Location">
          <HorizontalPicker
            options={locationSourceOptions}
            selected={locationSource}
            onSelect={(value) =>
              setLocationSource(value as AppointmentLocationSource)
            }
          />

          {locationSource === 'CUSTOMER_SITE' ? (
            sites.length ? (
              <HorizontalPicker
                options={sites.map((site) => ({
                  label: `${site.label} · ${site.suburb}`,
                  value: site.id,
                }))}
                selected={selectedSiteId}
                onSelect={setSelectedSiteId}
              />
            ) : (
              <Text style={styles.muted}>
                This customer has no active service sites yet.
              </Text>
            )
          ) : null}

          {locationSource === 'MANUAL' ? (
            <>
              <Field
                label="Address line 1"
                onChangeText={setManualAddressLine1}
                value={manualAddressLine1}
              />
              <Field
                label="Address line 2"
                onChangeText={setManualAddressLine2}
                value={manualAddressLine2}
              />
              <Field
                label="Suburb"
                onChangeText={setManualSuburb}
                value={manualSuburb}
              />
              <Text style={styles.label}>State</Text>
              <HorizontalPicker
                options={AUSTRALIAN_STATES.map((state) => ({
                  label: state,
                  value: state,
                }))}
                selected={manualState}
                onSelect={(value) => setManualState(value as AustralianState)}
              />
              <Field
                keyboardType="phone-pad"
                label="Postcode"
                onChangeText={setManualPostcode}
                value={manualPostcode}
              />
              <Field
                label="Access instructions"
                multiline
                onChangeText={setManualAccessInstructions}
                value={manualAccessInstructions}
              />
              <Toggle
                active={saveAddressAsSite}
                label="Save this address as a customer service site"
                onPress={() => setSaveAddressAsSite((current) => !current)}
              />
            </>
          ) : null}

          <View style={styles.summaryBox}>
            <Text style={styles.label}>Selected appointment location</Text>
            <Text style={styles.muted}>
              {formatLocation(resolvedLocation) ||
                'Choose or enter an appointment location.'}
            </Text>
            {resolvedLocation.accessInstructions ? (
              <Text style={styles.muted}>
                Access: {resolvedLocation.accessInstructions}
              </Text>
            ) : null}
          </View>
        </Section>

        <Section title="3. Job">
          {selectedJob && !useQuickJob ? (
            <View style={styles.summaryBox}>
              <Text style={styles.label}>Selected job</Text>
              <Text style={styles.summaryTitle}>
                {selectedJob.jobNumber} · {selectedJob.title}
              </Text>
              <Text style={styles.muted}>
                Create a new job only if this appointment should not be linked
                to the selected job.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSelectedJobId('');
                  setQuickJobTitle('');
                  setUseQuickJob(true);
                }}
                style={styles.clearButton}
              >
                <Text style={styles.clearButtonText}>
                  Create a different job
                </Text>
              </Pressable>
            </View>
          ) : null}
          {useQuickJob ? (
            <Field
              label="Job title"
              onChangeText={setQuickJobTitle}
              value={quickJobTitle}
            />
          ) : (
            <HorizontalPicker
              options={jobs.map((job) => ({
                label: `${job.jobNumber} · ${job.title}`,
                value: job.id,
              }))}
              selected={selectedJobId}
              onSelect={(value) => {
                setSelectedJobId(value);
                setQuickJobTitle(
                  jobs.find((existingJob) => existingJob.id === value)?.title ??
                    '',
                );
              }}
            />
          )}
          {!selectedJob && !useQuickJob ? (
            <Toggle
              active={useQuickJob}
              label="Create job for this appointment"
              onPress={() => setUseQuickJob(true)}
            />
          ) : null}
        </Section>

        <Section title="4. Technician">
          <HorizontalPicker
            options={[
              { label: 'Unassigned', value: '' },
              ...members.map((member) => ({
                label: member.name,
                value: member.userId ?? '',
              })),
            ]}
            selected={assignedUserId ?? ''}
            onSelect={(value) => setAssignedUserId(value || null)}
          />
        </Section>

        <Section title="5. Date and time">
          <View style={styles.summaryBox}>
            <Text style={styles.label}>Appointment time</Text>
            <Text style={styles.summaryTitle}>
              {formatBusinessDate(startAt, businessTimezone)}
            </Text>
            <Text style={styles.muted}>
              {formatBusinessTimeRange(
                startAt,
                addMinutes(startAt, durationMinutes),
                businessTimezone,
              )}
            </Text>
            <Text style={styles.muted}>
              {businessTimezone} ·{' '}
              {formatBusinessTimezoneAbbreviation(startAt, businessTimezone)}
            </Text>
          </View>
          <DateTimeButton
            label="Date"
            mode="date"
            onChange={onDateChange}
            setVisible={setShowDatePicker}
            timezone={businessTimezone}
            value={startAt}
            visible={showDatePicker}
          />
          <DateTimeButton
            label="Start time"
            mode="time"
            onChange={onTimeChange}
            setVisible={setShowTimePicker}
            timezone={businessTimezone}
            value={startAt}
            visible={showTimePicker}
          />
        </Section>

        <Section title="6. Duration/type">
          <Text style={styles.label}>Duration</Text>
          <HorizontalPicker
            options={durations.map((duration) => ({
              label: `${duration} min`,
              value: String(duration),
            }))}
            selected={String(durationMinutes)}
            onSelect={(value) => setDurationMinutes(Number(value))}
          />
          <HorizontalPicker
            options={appointmentTypes.map((type) => ({
              label: label(type),
              value: type,
            }))}
            selected={appointmentType}
            onSelect={(value) => setAppointmentType(value as AppointmentType)}
          />
        </Section>

        <Section title="7. Notes">
          <Field
            label="Notes"
            multiline
            onChangeText={setNotes}
            value={notes}
          />
        </Section>

        <Section title="8. Review and save">
          <Text style={styles.muted}>
            {selectedCustomer?.displayName || quickCustomerName || 'Customer'} ·{' '}
            {quickJobTitle || selectedJob?.title || 'Job'} ·{' '}
            {formatBusinessDate(startAt, businessTimezone)} at{' '}
            {formatBusinessTime(startAt, businessTimezone)}
          </Text>
          <Text style={styles.muted}>
            {formatBusinessTimeRange(
              startAt,
              addMinutes(startAt, durationMinutes),
              businessTimezone,
            )}{' '}
            · {businessTimezone} ·{' '}
            {formatBusinessTimezoneAbbreviation(startAt, businessTimezone)}
          </Text>
          <Text style={styles.muted}>
            Location: {formatLocation(resolvedLocation) || 'Not selected'}
          </Text>
        </Section>

        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={() => void save()}
          style={styles.saveButton}
        >
          <Text style={styles.saveText}>
            {isSaving ? 'Saving appointment...' : 'Save appointment'}
          </Text>
        </Pressable>
      </ScrollView>
      {isSaving ? (
        <View style={styles.loaderBackdrop}>
          <View style={styles.loaderCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.muted}>Saving appointment...</Text>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function DateTimeButton({
  label: text,
  mode,
  onChange,
  setVisible,
  timezone,
  value,
  visible,
}: {
  label: string;
  mode: 'date' | 'time';
  onChange(value?: Date): void;
  setVisible(value: boolean): void;
  timezone: string;
  value: Date;
  visible: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{text}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={styles.inputButton}
      >
        <Text style={styles.inputButtonText}>
          {mode === 'date'
            ? formatDate(value, timezone)
            : formatTime(value, timezone)}
        </Text>
      </Pressable>
      {visible ? (
        <DateTimePicker
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          mode={mode}
          onChange={(_, selectedDate) => {
            if (Platform.OS !== 'ios') setVisible(false);
            onChange(selectedDate);
          }}
          value={value}
        />
      ) : null}
      {visible && Platform.OS === 'ios' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisible(false)}
          style={styles.doneButton}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({
  keyboardType,
  label: text,
  multiline,
  onChangeText,
  value,
}: {
  keyboardType?: 'default' | 'phone-pad';
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{text}</Text>
      <TextInput
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={text}
        placeholderTextColor={colours.muted}
        style={[styles.input, multiline && styles.textarea]}
        value={value}
      />
    </View>
  );
}

function HorizontalPicker({
  onSelect,
  options,
  selected,
}: {
  onSelect(value: string): void;
  options: Array<{ label: string; value: string }>;
  selected: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.pickerRow}>
        {options.map((option) => (
          <Chip
            active={selected === option.value}
            key={`${option.value}-${option.label}`}
            label={option.label}
            onPress={() => onSelect(option.value)}
          />
        ))}
      </View>
    </ScrollView>
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

function Toggle({
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
      style={[styles.toggle, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colours.secondaryActionSurface,
    borderColor: '#C7D2FE',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colours.primary },
  chipText: { color: colours.primary, fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },
  clearButton: {
    alignSelf: 'flex-start',
    backgroundColor: colours.secondaryActionSurface,
    borderColor: '#C7D2FE',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clearButtonText: { color: colours.primary, fontWeight: '900' },
  container: {
    backgroundColor: colours.background,
    padding: 24,
    paddingBottom: 44,
  },
  doneButton: {
    alignSelf: 'flex-start',
    backgroundColor: colours.primary,
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  doneText: { color: '#FFFFFF', fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  field: { gap: 6, marginTop: 12 },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputButton: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  inputButtonText: { color: colours.ink, fontSize: 16, fontWeight: '700' },
  label: { color: colours.ink, fontWeight: '800', marginTop: 10 },
  loaderBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  loaderCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 10,
    padding: 22,
    width: '84%',
  },
  loadingPage: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  muted: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  page: { backgroundColor: colours.background, flex: 1 },
  pickerRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: 20,
    padding: 14,
  },
  saveText: { color: '#FFFFFF', fontWeight: '900' },
  section: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  summaryBox: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  summaryTitle: { color: colours.ink, fontSize: 17, fontWeight: '900' },
  textarea: { minHeight: 96, textAlignVertical: 'top' },
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
  toggle: {
    alignSelf: 'flex-start',
    backgroundColor: colours.secondaryActionSurface,
    borderColor: '#C7D2FE',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
