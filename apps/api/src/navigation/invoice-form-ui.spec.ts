import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('Invoice form mobile UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  it('uses native date pickers for issue and due dates instead of ISO text inputs', () => {
    const invoiceForm = mobileSource('screens/InvoiceFormScreen.tsx');

    expect(invoiceForm).toContain(
      "import DateTimePicker, {\n  type DateTimePickerEvent,\n} from '@react-native-community/datetimepicker';",
    );
    expect(invoiceForm).toContain('type InvoiceDateFieldName');
    expect(invoiceForm).toContain('label="Issue date"');
    expect(invoiceForm).toContain('label="Due date"');
    expect(invoiceForm).toContain("setDatePicker({ field: 'issueDate' })");
    expect(invoiceForm).toContain("setDatePicker({ field: 'dueDate' })");
    expect(invoiceForm).toContain('<DateTimePicker');
    expect(invoiceForm).not.toContain('Issue date (ISO)');
    expect(invoiceForm).not.toContain('Due date (ISO)');
    expect(invoiceForm).not.toContain('onChangeText={setIssueDate}');
    expect(invoiceForm).not.toContain('onChangeText={setDueDate}');
  });

  it('keeps invoice dates date-only in form state and serialises through the business timezone', () => {
    const invoiceForm = mobileSource('screens/InvoiceFormScreen.tsx');

    expect(invoiceForm).toContain('function businessDateOnly');
    expect(invoiceForm).toContain('function dateOnlyToBusinessIso');
    expect(invoiceForm).toContain('zonedTimeToUtc(parts, timezone)');
    expect(invoiceForm).toContain(
      'formatInvoiceDate(issueDate, businessTimezone)',
    );
    expect(invoiceForm).toContain(
      'formatInvoiceDate(dueDate, businessTimezone)',
    );
    expect(invoiceForm).toContain(
      'issueDate: dateOnlyToBusinessIso(issueDate, businessTimezone)',
    );
    expect(invoiceForm).toContain(
      'dueDate: dateOnlyToBusinessIso(dueDate, businessTimezone)',
    );
  });

  it('shows inline validation when due date is before issue date', () => {
    const invoiceForm = mobileSource('screens/InvoiceFormScreen.tsx');

    expect(invoiceForm).toContain('const dateValidationError = useMemo');
    expect(invoiceForm).toContain(
      "'Due date cannot be before the issue date.'",
    );
    expect(invoiceForm).toContain('error={dateValidationError}');
    expect(invoiceForm).toContain('if (dateValidationError)');
  });

  it('requires a customer before continuing from Scope to Items', () => {
    const invoiceForm = mobileSource('screens/InvoiceFormScreen.tsx');

    expect(invoiceForm).toContain('function goNext()');
    expect(invoiceForm).toContain('function validateStep');
    expect(invoiceForm).toContain('onPress={goNext}');
    expect(invoiceForm).toContain('if (step === 0 && !selectedCustomerId)');
    expect(invoiceForm).toContain(
      "return { message: 'Select a customer.', step: 0 }",
    );
  });

  it('keeps standalone and job-linked invoice scope valid once a customer is selected', () => {
    const invoiceForm = mobileSource('screens/InvoiceFormScreen.tsx');

    expect(invoiceForm).toContain('jobId: selectedJobId || null');
    expect(invoiceForm).toContain('customerId: selectedCustomerId');
    expect(invoiceForm).toContain('setSelectedCustomerId(job.customerId)');
    expect(invoiceForm).not.toContain('if (step === 0 && !selectedJobId)');
  });

  it('preserves quote-derived invoice flow while enforcing the customer gate', () => {
    const invoiceForm = mobileSource('screens/InvoiceFormScreen.tsx');

    expect(invoiceForm).toContain('sourceQuoteId');
    expect(invoiceForm).toContain(
      'setSelectedSourceQuoteId(draft.sourceQuoteId',
    );
    expect(invoiceForm).toContain(
      'sourceQuoteId: selectedSourceQuoteId || null',
    );
  });

  it('keeps Terms notes keyboard-safe with focused-field scrolling', () => {
    const invoiceForm = mobileSource('screens/InvoiceFormScreen.tsx');

    expect(invoiceForm).toContain(
      'const scrollRef = useRef<ScrollView | null>',
    );
    expect(invoiceForm).toContain(
      "type InvoiceTermsNotesFieldName = 'customerNotes' | 'internalNotes'",
    );
    expect(invoiceForm).toContain(
      'const notesOffsetYRef = useRef<Record<InvoiceTermsNotesFieldName, number>>',
    );
    expect(invoiceForm).toContain(
      'function scrollTermsNotesIntoView(field: InvoiceTermsNotesFieldName)',
    );
    expect(invoiceForm).toContain('ref={scrollRef}');
    expect(invoiceForm).toContain('keyboardShouldPersistTaps="handled"');
    expect(invoiceForm).toContain('label="Customer notes"');
    expect(invoiceForm).toContain('label="Internal notes"');
    expect(invoiceForm).toContain(
      "onFocus={() => scrollTermsNotesIntoView('customerNotes')}",
    );
    expect(invoiceForm).toContain(
      "onFocus={() => scrollTermsNotesIntoView('internalNotes')}",
    );
    expect(invoiceForm).toContain('notesOffsetYRef.current.customerNotes =');
    expect(invoiceForm).toContain('notesOffsetYRef.current.internalNotes =');
    expect(invoiceForm).not.toContain('keyboardHeight');
  });
});
