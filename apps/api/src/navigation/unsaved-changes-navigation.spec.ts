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
    expect(source).toContain(
      'isPreventRemoveArmed && isFormDirty && !hasSaved && !isSaving',
    );
  });

  it('dismisses the keyboard before showing the leave confirmation and rearms after Stay', () => {
    const source = readFileSync(appointmentFormPath, 'utf8');

    expect(source).toContain('Keyboard.dismiss()');
    expect(source).toContain('setIsPreventRemoveArmed(false)');
    expect(source).toContain('setIsPreventRemoveArmed(true)');
  });
});
