import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createUnsavedChangesNavigationGuard } from '@tradieos/shared';

describe('unsaved changes navigation guard', () => {
  function setup({
    hasSaved = false,
    isDirty = true,
    isMounted = true,
    isSaving = false,
  }: {
    hasSaved?: boolean;
    isDirty?: boolean;
    isMounted?: boolean;
    isSaving?: boolean;
  } = {}) {
    const beforeConfirmations: string[] = [];
    const discards: string[] = [];
    const stayResets: string[] = [];
    const dispatched: string[] = [];
    const prevented: string[] = [];
    const confirmations: Array<{ leave(): void; stay(): void }> = [];
    let confirmation:
      | {
          leave(): void;
          stay(): void;
        }
      | undefined;
    const guard = createUnsavedChangesNavigationGuard<string>({
      dispatch(action) {
        dispatched.push(action);
      },
      getHasSaved() {
        return hasSaved;
      },
      getIsDirty() {
        return isDirty;
      },
      getIsMounted() {
        return isMounted;
      },
      getIsSaving() {
        return isSaving;
      },
      onBeforeConfirmation() {
        beforeConfirmations.push('before');
      },
      onDiscard() {
        discards.push('discard');
      },
      onStay() {
        stayResets.push('stay');
      },
      requestConfirmation(handlers) {
        confirmation = handlers;
        confirmations.push(handlers);
      },
    });

    return {
      beforeConfirmations,
      confirmations,
      discards,
      dispatched,
      getConfirmation: () => confirmation,
      guard,
      preventDefault: () => prevented.push('prevented'),
      prevented,
      setHasSaved: (value: boolean) => {
        hasSaved = value;
      },
      setIsDirty: (value: boolean) => {
        isDirty = value;
      },
      setIsMounted: (value: boolean) => {
        isMounted = value;
      },
      setIsSaving: (value: boolean) => {
        isSaving = value;
      },
      stayResets,
    };
  }

  it('prevents dirty navigation and opens one confirmation', () => {
    const subject = setup();

    expect(
      subject.guard.handleBeforeRemove('BACK', subject.preventDefault),
    ).toBe(true);

    expect(subject.prevented).toEqual(['prevented']);
    expect(subject.getConfirmation()).toBeDefined();
    expect(subject.guard.isConfirmationOpen()).toBe(true);
  });

  it('keeps the form in place when the user chooses Stay', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    subject.getConfirmation()?.stay();

    expect(subject.dispatched).toEqual([]);
    expect(subject.guard.isConfirmationOpen()).toBe(false);
    expect(subject.stayResets).toEqual(['stay']);
  });

  it('dispatches the original action exactly once when the user chooses Leave', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    subject.getConfirmation()?.leave();

    expect(subject.dispatched).toEqual(['BACK']);
    expect(subject.guard.isConfirmationOpen()).toBe(false);
    expect(subject.discards).toEqual(['discard']);
  });

  it('dismisses active input before opening a confirmation', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);

    expect(subject.beforeConfirmations).toEqual(['before']);
  });

  it('allows clean form navigation immediately', () => {
    const subject = setup({ isDirty: false });

    expect(
      subject.guard.handleBeforeRemove('BACK', subject.preventDefault),
    ).toBe(false);

    expect(subject.prevented).toEqual([]);
    expect(subject.dispatched).toEqual([]);
    expect(subject.getConfirmation()).toBeUndefined();
  });

  it('allows successful save navigation without confirmation', () => {
    const subject = setup({ hasSaved: true, isDirty: true });

    expect(
      subject.guard.handleBeforeRemove('REPLACE', subject.preventDefault),
    ).toBe(false);

    expect(subject.prevented).toEqual([]);
    expect(subject.getConfirmation()).toBeUndefined();
  });

  it('prevents repeated back taps from opening duplicate confirmations', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    const firstConfirmation = subject.getConfirmation();
    subject.guard.handleBeforeRemove('BACK_AGAIN', subject.preventDefault);

    expect(subject.prevented).toEqual(['prevented', 'prevented']);
    expect(subject.getConfirmation()).toBe(firstConfirmation);
    expect(subject.dispatched).toEqual([]);
    expect(subject.confirmations).toHaveLength(1);
  });

  it('opens a fresh confirmation after Stay and another back attempt', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    const firstConfirmation = subject.getConfirmation();
    firstConfirmation?.stay();
    subject.guard.handleBeforeRemove('BACK_AGAIN', subject.preventDefault);

    expect(subject.confirmations).toHaveLength(2);
    expect(subject.getConfirmation()).not.toBe(firstConfirmation);
    expect(subject.guard.isConfirmationOpen()).toBe(true);
    expect(subject.dispatched).toEqual([]);
  });

  it('dispatches the second navigation action after Stay then Leave', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('FIRST_BACK', subject.preventDefault);
    subject.getConfirmation()?.stay();
    subject.guard.handleBeforeRemove('SECOND_BACK', subject.preventDefault);
    subject.getConfirmation()?.leave();

    expect(subject.dispatched).toEqual(['SECOND_BACK']);
  });

  it('handles repeated Stay taps without blocking the next cycle', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    const firstConfirmation = subject.getConfirmation();
    firstConfirmation?.stay();
    firstConfirmation?.stay();
    subject.guard.handleBeforeRemove('BACK_AGAIN', subject.preventDefault);

    expect(subject.stayResets).toEqual(['stay']);
    expect(subject.confirmations).toHaveLength(2);
    expect(subject.dispatched).toEqual([]);
  });

  it('does not dispatch a pending action after unmount', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    subject.setIsMounted(false);
    subject.getConfirmation()?.leave();

    expect(subject.dispatched).toEqual([]);
    expect(subject.guard.isConfirmationOpen()).toBe(false);
  });

  it('keeps the authorised removal bypass active until cleanup', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    subject.getConfirmation()?.leave();

    expect(
      subject.guard.handleBeforeRemove('BACK', subject.preventDefault),
    ).toBe(false);

    subject.guard.cleanup();

    expect(
      subject.guard.handleBeforeRemove('BACK_AGAIN', subject.preventDefault),
    ).toBe(true);
    expect(subject.dispatched).toEqual(['BACK']);
  });

  it('ignores repeated Leave taps after the original action has been dispatched', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    const confirmation = subject.getConfirmation();
    confirmation?.leave();
    confirmation?.leave();

    expect(subject.dispatched).toEqual(['BACK']);
    expect(subject.discards).toEqual(['discard']);
  });

  it('ignores alert dismissal after Leave so the removal bypass is not cleared early', () => {
    const subject = setup();

    subject.guard.handleBeforeRemove('BACK', subject.preventDefault);
    const confirmation = subject.getConfirmation();
    confirmation?.leave();
    confirmation?.stay();

    expect(subject.dispatched).toEqual(['BACK']);
    expect(
      subject.guard.handleBeforeRemove('BACK', subject.preventDefault),
    ).toBe(false);
    expect(subject.stayResets).toEqual([]);
  });
});

describe('AppointmentForm native-stack guard wiring', () => {
  const appointmentFormPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'mobile',
    'src',
    'screens',
    'AppointmentFormScreen.tsx',
  );

  it('uses usePreventRemove instead of a manual beforeRemove listener', () => {
    const source = readFileSync(appointmentFormPath, 'utf8');

    expect(source).toContain('usePreventRemove(');
    expect(source).not.toContain("addListener('beforeRemove'");
    expect(source).not.toContain('addListener("beforeRemove"');
  });

  it('routes prevented native-stack actions through the shared one-shot guard', () => {
    const source = readFileSync(appointmentFormPath, 'utf8');

    expect(source).toContain('guardRef.current.handlePreventedAction');
    expect(source).toContain('isFormDirty && !hasSaved && !isSaving');
  });

  it('dismisses the keyboard before showing the leave confirmation without a state-based rearm window', () => {
    const source = readFileSync(appointmentFormPath, 'utf8');

    expect(source).toContain('Keyboard.dismiss()');
    expect(source).not.toContain('setIsPreventRemoveArmed(false)');
    expect(source).not.toContain('setIsPreventRemoveArmed(true)');
    expect(source).not.toContain('isPreventRemoveArmed');
  });

  it('owns the AppointmentForm Main header button navigation path', () => {
    const source = readFileSync(appointmentFormPath, 'utf8');

    expect(source).toContain('headerLeft');
    expect(source).toContain('ScreenBackButton');
    expect(source).toContain('accessibilityLabel="Back to Main"');
    expect(source).toContain('label="Main"');
    expect(source).toContain('requestMainBack');
    expect(source).toContain('navigation.canGoBack()');
    expect(source).toContain('navigation.goBack()');
    expect(source).toContain("CommonActions.navigate('Main')");
    expect(source).toContain('APPOINTMENT_FORM_MAIN_PRESS');
  });

  it('falls back through the shared guard when AppointmentForm has no back stack', () => {
    const source = readFileSync(appointmentFormPath, 'utf8');

    expect(source).toContain(
      'guardRef.current.handlePreventedAction(fallbackAction)',
    );
    expect(source).toContain('navigation.dispatch(fallbackAction)');
  });
});

describe('AppointmentDetails field-note guard wiring', () => {
  const appointmentDetailsPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'mobile',
    'src',
    'screens',
    'AppointmentDetailsScreen.tsx',
  );
  const screenBackButtonPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'mobile',
    'src',
    'components',
    'ScreenBackButton.tsx',
  );

  it('uses usePreventRemove instead of a manual beforeRemove listener', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('usePreventRemove(');
    expect(source).not.toContain("addListener('beforeRemove'");
    expect(source).not.toContain('addListener("beforeRemove"');
  });

  it('routes dirty field-note navigation through the shared one-shot guard', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('guardRef.current.handlePreventedAction');
    expect(source).toContain('hasUnsavedWorkLog');
    expect(source).toContain('canEditCurrentWorkLog');
    expect(source).toContain("busyText !== 'Saving field notes...'");
  });

  it('dismisses the keyboard before confirmation without a state-based rearm window', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('Keyboard.dismiss()');
    expect(source).not.toContain('setIsPreventRemoveArmed(false)');
    expect(source).not.toContain('setIsPreventRemoveArmed(true)');
    expect(source).toContain('workLogDirtyRef.current');
  });

  it('marks field notes clean synchronously after a successful save', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('workLogDirtyRef.current = false');
    expect(source).toContain('guardRef.current.cleanup()');
    expect(source).toContain('setAppointment(response.appointment)');
  });

  it('shows inline field-note and completion validation errors', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('validateAppointmentFieldWork');
    expect(source).toContain('validateAppointmentCompletion');
    expect(source).toContain('fieldErrors.followUpNotes');
    expect(source).toContain('completionErrors.workCompleted');
    expect(source).toContain('errors.signature');
    expect(source).toContain('styles.inputError');
    expect(source).toContain('styles.errorText');
  });

  it('uses the shared dirty helper for guard and Save button visibility', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('savedFieldNotesRef');
    expect(source).toContain('normaliseAppointmentFieldNotes');
    expect(source).toContain('isAppointmentFieldNotesDirty');
    expect(source).toContain('{hasUnsavedWorkLog ? (');
    expect(source).toContain('saveFieldNotesButton');
    expect(source).toContain("'Saving...'");
  });

  it('owns the AppointmentDetails Main header button navigation path', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('headerLeft');
    expect(source).toContain('ScreenBackButton');
    expect(source).toContain('accessibilityLabel="Back to Main"');
    expect(source).toContain('label="Main"');
    expect(source).toContain('requestMainBack');
    expect(source).toContain('navigation.canGoBack()');
    expect(source).toContain('navigation.goBack()');
    expect(source).toContain("CommonActions.navigate('Main')");
    expect(source).toContain('APPOINTMENT_DETAILS_MAIN_PRESS');
    expect(source).toContain('APPOINTMENT_DETAILS_GO_BACK_DISPATCHED');
  });

  it('uses a real Main fallback instead of silently doing nothing when no back stack exists', () => {
    const source = readFileSync(appointmentDetailsPath, 'utf8');

    expect(source).toContain('APPOINTMENT_DETAILS_FALLBACK_TO_MAIN');
    expect(source).toContain(
      'guardRef.current.handlePreventedAction(fallbackAction)',
    );
    expect(source).toContain('navigation.dispatch(fallbackAction)');
  });

  it('renders the shared back button as a compact chevron plus label control', () => {
    const source = readFileSync(screenBackButtonPath, 'utf8');

    expect(source).toContain('chevronFrame');
    expect(source).toContain('borderLeftWidth: 2.25');
    expect(source).toContain('minHeight: 44');
    expect(source).toContain('paddingHorizontal: 12');
    expect(source).toContain('marginRight: 7');
    expect(source).toContain("alignItems: 'center'");
    expect(source).toContain("justifyContent: 'center'");
    expect(source).toContain('includeFontPadding: false');
    expect(source).toContain('color: colours.ink');
    expect(source).not.toContain('flex: 1');
    expect(source).not.toContain('minWidth: 64');
  });
});
