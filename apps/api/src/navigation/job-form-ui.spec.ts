import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('Job form mobile UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  it('uses native date/time picker controls for scheduled start and end', () => {
    const jobForm = mobileSource('screens/JobFormScreen.tsx');

    expect(jobForm).toContain(
      "import DateTimePicker, {\n  type DateTimePickerEvent,\n} from '@react-native-community/datetimepicker';",
    );
    expect(jobForm).toContain('<ScheduleDateTimeField');
    expect(jobForm).toContain('label="Scheduled start"');
    expect(jobForm).toContain(
      "setPicker({ field: 'scheduledStart', mode: 'date' })",
    );
    expect(jobForm).toContain('label="Scheduled end"');
    expect(jobForm).toContain(
      "setPicker({ field: 'scheduledEnd', mode: 'date' })",
    );
    expect(jobForm).toContain('<DateTimePicker');
    expect(jobForm).toContain("picker.mode === 'date'");
    expect(jobForm).toContain("mode: 'time'");
  });

  it('adds optional quick-customer email in Job and Appointment forms', () => {
    const jobForm = mobileSource('screens/JobFormScreen.tsx');
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');
    const sharedJobs = readFileSync(
      join(repoRoot, 'packages', 'shared', 'src', 'jobs.ts'),
      'utf8',
    );
    const jobsDto = readFileSync(
      join(repoRoot, 'apps', 'api', 'src', 'jobs', 'dto', 'jobs.dto.ts'),
      'utf8',
    );

    expect(sharedJobs).toContain('email?: string;');
    expect(jobsDto).toContain('@IsEmail()');
    for (const source of [jobForm, appointmentForm]) {
      expect(source).toContain('label="Email address"');
      expect(source).toContain('keyboardType="email-address"');
      expect(source).toContain('autoCapitalize="none"');
      expect(source).toContain('autoComplete="email"');
      expect(source).toContain('textContentType="emailAddress"');
    }
    expect(jobForm).toMatch(
      /email:\s*form\.quickCustomer\.email\?\.trim\(\)\.toLowerCase\(\)\s*\|\|\s*undefined/,
    );
    expect(appointmentForm).toMatch(
      /email:\s*quickCustomerEmail\.trim\(\)\.toLowerCase\(\)\s*\|\|\s*undefined/,
    );
  });

  it('keeps schedule values human-readable while preserving API ISO payloads', () => {
    const jobForm = mobileSource('screens/JobFormScreen.tsx');

    expect(jobForm).toContain('function humanDateTime');
    expect(jobForm).toContain("month: 'short'");
    expect(jobForm).toContain(
      'scheduledStart: new Date(form.scheduledStart).toISOString()',
    );
    expect(jobForm).toContain('new Date(form.scheduledEnd).toISOString()');
  });

  it('keeps end-before-start validation visible on scheduled end', () => {
    const jobForm = mobileSource('screens/JobFormScreen.tsx');

    expect(jobForm).toContain(
      "next.scheduledEnd = 'End time must be after start time.';",
    );
    expect(jobForm).toContain('error={errors.scheduledEnd}');
  });

  it('derives estimated duration from scheduled start and end picker values', () => {
    const jobForm = mobileSource('screens/JobFormScreen.tsx');

    expect(jobForm).toContain('function calculateDurationMinutes');
    expect(jobForm).toContain('end.getTime() - start.getTime()');
    expect(jobForm).toContain('return diffMinutes > 0 ? diffMinutes : null');
    expect(jobForm).toContain('updateScheduleValue(field: ScheduleField');
    expect(jobForm).toContain(
      'estimatedDurationMinutes:\n          duration ?? current.estimatedDurationMinutes ?? null',
    );
    expect(jobForm).toContain(
      'scheduledStart: new Date(form.scheduledStart).toISOString()',
    );
    expect(jobForm).toContain('new Date(form.scheduledEnd).toISOString()');
  });

  it('renders quote and invoice requirement toggles side-by-side with selectable state', () => {
    const jobForm = mobileSource('screens/JobFormScreen.tsx');

    expect(jobForm).toContain('styles.requirementsRow');
    expect(jobForm).toContain('label="Requires quote"');
    expect(jobForm).toContain('label="Requires invoice"');
    expect(jobForm).toContain('accessibilityState={{ selected: active }}');
    expect(jobForm).toContain('styles.toggleActive');
    expect(jobForm).toContain('colours.secondaryActionSurface');
    expect(jobForm).toContain("flexDirection: 'row'");
    expect(jobForm).toContain("flexWrap: 'wrap'");
  });

  it('shows the actual selected customer name when scheduling an appointment from a job', () => {
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');

    expect(appointmentForm).toContain('function upsertCustomer');
    expect(appointmentForm).toContain(
      'setCustomers((current) => upsertCustomer(current, detail.customer))',
    );
    expect(appointmentForm).toContain('{selectedCustomer.displayName}');
    expect(appointmentForm).not.toContain(
      'selectedCustomer.companyName ??\n                      selectedCustomer.displayName',
    );
  });

  it('keeps appointment customer search labels anchored to displayName', () => {
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');

    expect(appointmentForm).toContain('customer.displayName');
    expect(appointmentForm).toContain('customer.companyName');
    expect(appointmentForm).toContain('customer.email');
    expect(appointmentForm).toContain('customer.phone');
    expect(appointmentForm).toContain('customer.suburb');
    expect(appointmentForm).toContain(".join('\\n')");
    expect(appointmentForm).not.toContain(
      'customer.companyName ??\n                        `${customer.displayName}',
    );
  });

  it('keeps selected jobs primary and demotes creating another job to an explicit alternative', () => {
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');

    expect(appointmentForm).toContain(
      '<Text style={styles.label}>Selected job</Text>',
    );
    expect(appointmentForm).toContain('Create a different job');
    expect(appointmentForm).toContain('hasSelectedExistingJob');
    expect(appointmentForm).toContain(
      'setSelectedCustomerId(jobResponse.job.customerId)',
    );
    expect(appointmentForm).toContain('setSelectedJobId');
    expect(appointmentForm).toContain('setUseQuickJob(true)');
    expect(appointmentForm).toContain('{!hasSelectedExistingJob ? (');
    expect(appointmentForm).toContain(
      'label="Create job for this appointment"',
    );
    expect(appointmentForm.indexOf('Selected job')).toBeLessThan(
      appointmentForm.indexOf('label="Create job for this appointment"'),
    );
  });

  it('wires address entry through an autocomplete-ready manual fallback component', () => {
    const addressInput = mobileSource(
      'components/AddressAutocompleteInput.tsx',
    );
    const jobForm = mobileSource('screens/JobFormScreen.tsx');
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');

    expect(addressInput).toContain('export type AddressSuggestionProvider');
    expect(addressInput).toContain('const MIN_QUERY_LENGTH = 3');
    expect(addressInput).toContain('const DEBOUNCE_MS = 300');
    expect(addressInput).toContain('manual');
    expect(addressInput).toContain('onSelectSuggestion');
    expect(jobForm).toContain('<AddressAutocompleteInput');
    expect(jobForm).toContain('applyAddressSuggestion');
    expect(appointmentForm).toContain('<AddressAutocompleteInput');
    expect(appointmentForm).toContain('applyManualAddressSuggestion');
  });

  it('uses enabled secondary appointment actions instead of disabled-looking chips', () => {
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');

    expect(appointmentForm).toContain('colours.secondaryActionSurface');
    expect(appointmentForm).toContain("borderColor: '#C7D2FE'");
    expect(appointmentForm).toContain('chipText: { color: colours.primary');
    expect(appointmentForm).toContain('clearButton');
    expect(appointmentForm).toContain('toggle');
    expect(appointmentForm).toContain(
      'chipActive: { backgroundColor: colours.primary }',
    );
  });

  it('centres Job Details secondary action button labels', () => {
    const jobDetails = mobileSource('screens/JobDetailsScreen.tsx');

    expect(jobDetails).toContain('function ActionButton');
    expect(jobDetails).toContain("alignItems: 'center'");
    expect(jobDetails).toContain("justifyContent: 'center'");
    expect(jobDetails).toContain("textAlign: 'center'");
    expect(jobDetails).toContain('label="Add photo evidence"');
    expect(jobDetails).toContain('label="Add document"');
    expect(jobDetails).toContain("'Create quote'");
    expect(jobDetails).toContain("'Create invoice'");
  });
});
