import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('customer communications mobile UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  it('separates appointment create errors from lifecycle transition errors', () => {
    const client = mobileSource('api/client.ts');
    const appointmentForm = mobileSource('screens/AppointmentFormScreen.tsx');

    expect(client).toContain('friendlyAppointmentCreateError');
    expect(client).toContain("error.code === 'APPOINTMENT_CONFLICT'");
    expect(client).toContain(
      'already has another appointment during this time',
    );
    expect(client).toContain('friendlyAppointmentMutationError');
    expect(client).toContain(
      'This appointment can no longer perform that action.',
    );
    expect(appointmentForm).toContain('friendlyAppointmentCreateError');
    expect(appointmentForm).toContain(
      'message: friendlyAppointmentCreateError(error)',
    );
  });

  it('keeps the Send Customer Message modal keyboard-safe and scrollable', () => {
    const customerDetails = mobileSource('screens/CustomerDetailsScreen.tsx');

    expect(customerDetails).toContain('KeyboardAvoidingView');
    expect(customerDetails).toContain('Keyboard.dismiss');
    expect(customerDetails).toContain('keyboardDismissMode');
    expect(customerDetails).toContain('keyboardShouldPersistTaps="handled"');
    expect(customerDetails).toContain('styles.modalScrollContent');
  });

  it('keeps the Customer Form keyboard-safe with safe bottom scroll padding', () => {
    const customerForm = mobileSource('screens/CustomerFormScreen.tsx');

    expect(customerForm).toContain('KeyboardAvoidingView');
    expect(customerForm).toContain('keyboardAvoidingBehavior');
    expect(customerForm).toContain('useSafeAreaInsets');
    expect(customerForm).toContain('keyboardShouldPersistTaps="handled"');
    expect(customerForm).toContain('keyboardDismissMode');
    expect(customerForm).toContain('Math.max(insets.bottom + 96, 120)');
  });

  it('keeps the Customer Details archive action above the bottom safe area', () => {
    const customerDetails = mobileSource('screens/CustomerDetailsScreen.tsx');

    expect(customerDetails).toContain('useSafeAreaInsets');
    expect(customerDetails).toContain('Math.max(insets.bottom + 72, 104)');
    expect(customerDetails).toContain('Archive customer');
    expect(customerDetails).toContain('Restore customer');
  });

  it('renders customer activity with clean Unicode separators', () => {
    const customerDetails = mobileSource('screens/CustomerDetailsScreen.tsx');

    expect(customerDetails).toContain("const ACTIVITY_SEPARATOR = '\\u2014'");
    expect(customerDetails).toContain(
      "{site.isPrimary ? '\\u2022 Primary' : ''}",
    );
    expect(customerDetails).not.toContain('â€”');
    expect(customerDetails).not.toContain('â€¢');
  });

  it('keeps one in-app customer message entry point and preserves device actions', () => {
    const customerDetails = mobileSource('screens/CustomerDetailsScreen.tsx');

    expect(customerDetails.match(/setMessageModal\(true\)/g)).toHaveLength(1);
    expect(customerDetails).toContain(
      '<Text style={styles.secondaryText}>Send message</Text>',
    );
    expect(customerDetails).not.toContain('label="Send Message"');
    expect(customerDetails).toContain(
      'Linking.openURL(`tel:${customer.phone}`)',
    );
    expect(customerDetails).toContain(
      'Linking.openURL(`sms:${customer.phone}`)',
    );
    expect(customerDetails).toContain(
      'Linking.openURL(`mailto:${customer.email}`)',
    );
  });

  it('refreshes customer communications on focus and labels scheduled reminders clearly', () => {
    const customerDetails = mobileSource('screens/CustomerDetailsScreen.tsx');

    expect(customerDetails).toContain('useFocusEffect');
    expect(customerDetails).toContain('customerCommunicationsRequest');
    expect(customerDetails).toContain('{ customerId, pageSize: 100 }');
    expect(customerDetails).toContain('communicationDateLabel');
    expect(customerDetails).toContain('Scheduled for');
    expect(customerDetails).toContain('formatBusinessDateTime');
    expect(customerDetails).toContain('isCommunicationsLoading');
    expect(customerDetails).toContain('communicationsError');
    expect(customerDetails).toContain('loadRequestIdRef');
    expect(customerDetails).toContain('isLatestRequest');
    expect(customerDetails).toContain('Loading communications...');
    expect(customerDetails).toContain(
      "We couldn't load this customer's communications.",
    );
    expect(customerDetails).toContain("value.replaceAll('_', ' ')");
    expect(customerDetails).toContain('Cancelled');
  });

  it('exposes supported quote acceptance and decline actions in Quote Details', () => {
    const quoteDetails = mobileSource('screens/QuoteDetailsScreen.tsx');
    const client = mobileSource('api/client.ts');

    expect(client).toContain('declineQuoteRequest');
    expect(client).toContain('`/quotes/${quoteId}/decline`');
    expect(quoteDetails).toContain('roleCanAcceptOrDeclineQuote');
    expect(quoteDetails).toContain('Mark accepted');
    expect(quoteDetails).toContain('Mark declined');
    expect(quoteDetails).toContain('Decline quote');
  });

  it('uses explicit appointment reschedule controls instead of fixed increment rescheduling', () => {
    const appointmentDetails = mobileSource(
      'screens/AppointmentDetailsScreen.tsx',
    );
    const sharedAppointments = readFileSync(
      join(repoRoot, 'packages', 'shared', 'src', 'appointments.ts'),
      'utf8',
    );

    expect(appointmentDetails).toContain('RescheduleModal');
    expect(appointmentDetails).toContain('Save reschedule');
    expect(appointmentDetails).toContain('New date');
    expect(appointmentDetails).toContain('New start time');
    expect(appointmentDetails).toContain('setRescheduleDuration');
    expect(appointmentDetails).toContain(
      'estimatedDurationMinutes: rescheduleDuration',
    );
    expect(appointmentDetails).toContain('confirmCancelAppointment');
    expect(sharedAppointments).toContain('Cancel appointment');
    expect(sharedAppointments).not.toContain("label: 'Cancel',");
    expect(appointmentDetails).toContain('Close</Text>');
    expect(appointmentDetails).not.toContain('rescheduleByOneHour');
    expect(appointmentDetails).not.toContain('moved forward by 1 hour');
  });

  it('uses enabled secondary-button styling that is distinct from disabled styling', () => {
    const theme = mobileSource('theme.ts');
    const customerDetails = mobileSource('screens/CustomerDetailsScreen.tsx');
    const quoteForm = mobileSource('screens/QuoteFormScreen.tsx');
    const invoiceDetails = mobileSource('screens/InvoiceDetailsScreen.tsx');

    expect(theme).toContain('secondaryActionSurface');
    for (const source of [customerDetails, quoteForm, invoiceDetails]) {
      expect(source).toContain('colours.secondaryActionSurface');
      expect(source).toContain('borderColor: colours.primary');
      expect(source).toContain('color: colours.primary');
    }
    expect(customerDetails).toContain('disabledButton: { opacity: 0.45 }');
    expect(quoteForm).toContain('disabled: { opacity: 0.4 }');
    expect(invoiceDetails).toContain('disabledAction');
  });

  it('shows communication settings to roles that can access settings', () => {
    const settings = mobileSource('screens/SettingsScreen.tsx');

    expect(settings).toContain('communicationSettingsRequest(token)');
    expect(settings).toContain('Communication settings');
    expect(settings.indexOf('Business workspace')).toBeLessThan(
      settings.indexOf('Communication settings'),
    );
    expect(settings.indexOf('Communication settings')).toBeLessThan(
      settings.lastIndexOf('Log out'),
    );
    expect(settings).toContain('<ScrollView contentContainerStyle');
  });
});
