import {
  APPOINTMENT_FIELD_VALIDATION_MESSAGES,
  hasAppointmentValidationErrors,
  isAppointmentFieldNotesDirty,
  normaliseAppointmentFieldNotes,
  validateAppointmentCompletion,
  validateAppointmentFieldWork,
} from '@tradieos/shared';

describe('appointment field-note and completion validation', () => {
  it('normalises API null text and local empty strings as equal', () => {
    expect(
      isAppointmentFieldNotesDirty(
        {
          followUpNotes: '',
          followUpRequired: false,
          technicianNotes: '',
          workCompleted: '',
        },
        {
          followUpNotes: null,
          followUpRequired: false,
          technicianNotes: null,
          workCompleted: null,
        },
      ),
    ).toBe(false);
  });

  it('normalises API undefined text and local empty strings as equal', () => {
    expect(
      isAppointmentFieldNotesDirty(
        {
          followUpNotes: '',
          followUpRequired: false,
          technicianNotes: '',
          workCompleted: '',
        },
        {},
      ),
    ).toBe(false);
  });

  it('normalises undefined follow-up required and local false as equal', () => {
    expect(
      isAppointmentFieldNotesDirty(
        { followUpRequired: false },
        { followUpRequired: undefined },
      ),
    ).toBe(false);
  });

  it('does not mark an untouched form dirty', () => {
    const baseline = normaliseAppointmentFieldNotes({
      followUpNotes: 'Return with new switch.',
      followUpRequired: true,
      technicianNotes: 'Customer requested tidy finish.',
      workCompleted: 'Replaced switch.',
    });

    expect(isAppointmentFieldNotesDirty(baseline, baseline)).toBe(false);
  });

  it('marks technician note edits dirty', () => {
    expect(
      isAppointmentFieldNotesDirty(
        { technicianNotes: 'Updated notes' },
        { technicianNotes: '' },
      ),
    ).toBe(true);
  });

  it('marks work completed edits dirty', () => {
    expect(
      isAppointmentFieldNotesDirty(
        { workCompleted: 'Replaced switch.' },
        { workCompleted: '' },
      ),
    ).toBe(true);
  });

  it('marks toggling follow-up on dirty', () => {
    expect(
      isAppointmentFieldNotesDirty(
        { followUpRequired: true },
        { followUpRequired: false },
      ),
    ).toBe(true);
  });

  it('marks toggling follow-up off from a saved-on state dirty', () => {
    expect(
      isAppointmentFieldNotesDirty(
        { followUpNotes: 'Return tomorrow.', followUpRequired: false },
        { followUpNotes: 'Return tomorrow.', followUpRequired: true },
      ),
    ).toBe(true);
  });

  it('ignores hidden follow-up details when follow-up is off', () => {
    expect(
      isAppointmentFieldNotesDirty(
        { followUpNotes: 'Hidden local draft', followUpRequired: false },
        { followUpNotes: '', followUpRequired: false },
      ),
    ).toBe(false);
  });

  it('successful-save baseline updates make the form clean', () => {
    const saved = normaliseAppointmentFieldNotes({
      followUpNotes: 'Return with replacement breaker.',
      followUpRequired: true,
      technicianNotes: 'Breaker is intermittent.',
      workCompleted: 'Made site safe.',
    });

    expect(isAppointmentFieldNotesDirty(saved, saved)).toBe(false);
  });

  it('validation errors alone do not make field notes dirty', () => {
    const validationErrors = validateAppointmentFieldWork({
      followUpNotes: '',
      followUpRequired: true,
    });

    expect(validationErrors.followUpNotes).toBe(
      APPOINTMENT_FIELD_VALIDATION_MESSAGES.FOLLOW_UP_NOTES_REQUIRED,
    );
    expect(
      isAppointmentFieldNotesDirty(
        { followUpRequired: false },
        { followUpRequired: false },
      ),
    ).toBe(false);
  });

  it('requires follow-up notes when follow-up is enabled', () => {
    expect(
      validateAppointmentFieldWork({
        followUpNotes: '',
        followUpRequired: true,
      }),
    ).toEqual({
      followUpNotes:
        APPOINTMENT_FIELD_VALIDATION_MESSAGES.FOLLOW_UP_NOTES_REQUIRED,
    });
  });

  it('rejects whitespace-only follow-up notes when follow-up is enabled', () => {
    expect(
      validateAppointmentFieldWork({
        followUpNotes: '   ',
        followUpRequired: true,
      }),
    ).toEqual({
      followUpNotes:
        APPOINTMENT_FIELD_VALIDATION_MESSAGES.FOLLOW_UP_NOTES_REQUIRED,
    });
  });

  it('accepts follow-up notes when follow-up is enabled and details are provided', () => {
    expect(
      validateAppointmentFieldWork({
        followUpNotes: 'Return with replacement breaker.',
        followUpRequired: true,
      }),
    ).toEqual({});
  });

  it('does not require follow-up notes when follow-up is disabled', () => {
    expect(
      validateAppointmentFieldWork({
        followUpNotes: '',
        followUpRequired: false,
      }),
    ).toEqual({});
  });

  it('blocks completion when work completed is empty', () => {
    expect(
      validateAppointmentCompletion({
        followUpRequired: false,
        hasSignature: true,
        workCompleted: '',
      }),
    ).toMatchObject({
      workCompleted:
        APPOINTMENT_FIELD_VALIDATION_MESSAGES.WORK_COMPLETED_REQUIRED,
    });
  });

  it('blocks completion when work completed is whitespace only', () => {
    expect(
      validateAppointmentCompletion({
        followUpRequired: false,
        hasSignature: true,
        workCompleted: '   ',
      }),
    ).toMatchObject({
      workCompleted:
        APPOINTMENT_FIELD_VALIDATION_MESSAGES.WORK_COMPLETED_REQUIRED,
    });
  });

  it('allows completion when required fields and signature are present', () => {
    const errors = validateAppointmentCompletion({
      followUpNotes: 'Quote another visit.',
      followUpRequired: true,
      hasSignature: true,
      workCompleted: 'Replaced faulty switch and tested circuit.',
    });

    expect(errors).toEqual({});
    expect(hasAppointmentValidationErrors(errors)).toBe(false);
  });

  it('requires signature or authorised skip reason before completion', () => {
    expect(
      validateAppointmentCompletion({
        followUpRequired: false,
        hasSignature: false,
        workCompleted: 'Completed repairs.',
      }),
    ).toMatchObject({
      signature: APPOINTMENT_FIELD_VALIDATION_MESSAGES.SIGNATURE_REQUIRED,
    });
  });
});
