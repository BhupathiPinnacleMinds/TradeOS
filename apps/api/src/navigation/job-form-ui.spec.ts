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

  it('keeps selected jobs primary and demotes creating another job to an explicit alternative', () => {
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');

    expect(appointmentForm).toContain(
      '<Text style={styles.label}>Selected job</Text>',
    );
    expect(appointmentForm).toContain('Create a different job');
    expect(appointmentForm).toContain('setSelectedJobId');
    expect(appointmentForm).toContain('setUseQuickJob(true)');
    expect(appointmentForm).toContain(
      'label="Create job for this appointment"',
    );
    expect(appointmentForm.indexOf('Selected job')).toBeLessThan(
      appointmentForm.indexOf('label="Create job for this appointment"'),
    );
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
