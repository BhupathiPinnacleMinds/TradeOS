import { readFileSync } from 'fs';
import { join } from 'path';

describe('invoice payment mobile UX contract', () => {
  const root = join(__dirname, '..', '..', '..', 'mobile');

  it('keeps the record-payment modal safe-area, keyboard and scroll aware', () => {
    const screen = readFileSync(
      join(root, 'src', 'screens', 'InvoiceDetailsScreen.tsx'),
      'utf8',
    );

    expect(screen).toContain('<SafeAreaView style={styles.modalSafeArea}>');
    expect(screen).toContain('<KeyboardAvoidingView');
    expect(screen).toContain(
      "import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';",
    );
    expect(screen).toContain('behavior={keyboardAvoidingBehavior}');
    expect(screen).toContain('<ScrollView');
    expect(screen).toContain('keyboardShouldPersistTaps="handled"');
    expect(screen).toContain('contentContainerStyle={styles.modal}');
    expect(screen).toContain('flexGrow: 1');
  });

  it('shows inline amount validation before recording payment', () => {
    const screen = readFileSync(
      join(root, 'src', 'screens', 'InvoiceDetailsScreen.tsx'),
      'utf8',
    );
    const validationIndex = screen.indexOf('validateInvoicePaymentAmount');
    const requestIndex = screen.indexOf('recordInvoicePaymentRequest');

    expect(validationIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(requestIndex);
    expect(screen).toContain('setPaymentAmountError');
    expect(screen).toContain('paymentAmountInputRef.current?.focus()');
    expect(screen).toContain('Payment cannot exceed the remaining balance.');
  });

  it('uses the shared invoice action helper instead of scattered status checks', () => {
    const screen = readFileSync(
      join(root, 'src', 'screens', 'InvoiceDetailsScreen.tsx'),
      'utf8',
    );

    expect(screen).toContain('getInvoiceAvailableActions');
    expect(screen).toContain("availableActions.has('EDIT')");
    expect(screen).toContain("availableActions.has('SEND')");
    expect(screen).toContain("availableActions.has('RECORD_PAYMENT')");
    expect(screen).toContain("availableActions.has('VOID')");
    expect(screen).not.toContain('roleCanEditInvoice(role, invoice.status)');
    expect(screen).not.toContain('roleCanSendInvoice(role, invoice.status)');
    expect(screen).not.toContain(
      'roleCanRecordInvoicePayment(role, invoice.status)',
    );
    expect(screen).not.toContain('roleCanVoidInvoice(role, invoice.status)');
  });

  it('maps expected invoice lifecycle errors to friendly mobile copy', () => {
    const client = readFileSync(join(root, 'src', 'api', 'client.ts'), 'utf8');
    const screen = readFileSync(
      join(root, 'src', 'screens', 'InvoiceDetailsScreen.tsx'),
      'utf8',
    );

    expect(client).toContain('friendlyInvoiceMutationError');
    expect(client).toContain('INVOICE_INVALID_STATUS');
    expect(client).toContain('INVOICE_PAYMENT_EXCEEDS_BALANCE');
    expect(client).toContain('Invoice action is temporarily unavailable');
    expect(screen).toContain('friendlyInvoiceMutationError(mutationError)');
  });
});
