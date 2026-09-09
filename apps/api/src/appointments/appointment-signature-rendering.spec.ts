import {
  APPOINTMENT_SIGNATURE_ACTION_GAP,
  APPOINTMENT_SIGNATURE_PAD_HEIGHT,
  APPOINTMENT_SIGNATURE_SKIP_REASON_BUTTON_GAP,
  APPOINTMENT_SIGNATURE_SKIP_REASON_INPUT_GAP,
  APPOINTMENT_SIGNATURE_SKIP_REASON_TOP_SPACING,
  APPOINTMENT_SIGNATURE_STROKE_COLOUR,
  APPOINTMENT_SIGNATURE_STROKE_WIDTH,
  appointmentSignaturePointFromEvent,
  buildAppointmentSignatureStrokeSegments,
  buildAppointmentSignatureSkipReason,
  clearAppointmentSignatureData,
  hasAppointmentSignatureStrokes,
  isAppointmentCompletionSignatureScrollEnabled,
  type AppointmentSignatureData,
} from '@tradieos/shared';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('appointment signature rendering contract', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  const signatureData: AppointmentSignatureData = {
    height: APPOINTMENT_SIGNATURE_PAD_HEIGHT,
    strokes: [
      [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 50 },
      ],
      [
        { x: 80, y: 90 },
        { x: 100, y: 110 },
      ],
    ],
    width: 320,
  };

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  it('renders a multi-point stroke as connected line segments instead of point dots', () => {
    const segments = buildAppointmentSignatureStrokeSegments({
      strokes: [signatureData.strokes[0]],
    });

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.segmentIndex)).toEqual([0, 1]);
    expect(segments[0]).toMatchObject({
      angleDegrees: 0,
      from: { x: 10, y: 20 },
      length: 30,
      strokeIndex: 0,
      to: { x: 40, y: 20 },
    });
    expect(segments[1]).toMatchObject({
      angleDegrees: 90,
      from: { x: 40, y: 20 },
      length: 30,
      strokeIndex: 0,
      to: { x: 40, y: 50 },
    });
  });

  it('keeps multiple signature strokes separate while each remains continuous', () => {
    const segments = buildAppointmentSignatureStrokeSegments(signatureData);

    expect(segments).toHaveLength(3);
    expect(
      segments.filter((segment) => segment.strokeIndex === 0),
    ).toHaveLength(2);
    expect(
      segments.filter((segment) => segment.strokeIndex === 1),
    ).toHaveLength(1);
    expect(segments).not.toContainEqual(
      expect.objectContaining({
        from: { x: 40, y: 50 },
        to: { x: 80, y: 90 },
      }),
    );
  });

  it('uses measured page coordinates for Android signature moves instead of child-relative locations', () => {
    expect(
      appointmentSignaturePointFromEvent({
        frame: { height: 240, width: 320, x: 20, y: 100 },
        locationX: 2,
        locationY: 3,
        pageX: 180,
        pageY: 220,
      }),
    ).toEqual({ x: 160, y: 120 });
  });

  it('falls back to local coordinates when the signature pad has not been measured yet', () => {
    expect(
      appointmentSignaturePointFromEvent({
        frame: null,
        locationX: 24,
        locationY: 36,
        pageX: 180,
        pageY: 220,
      }),
    ).toEqual({ x: 24, y: 36 });
  });

  it('clamps signature points inside the fixed pad bounds', () => {
    expect(
      appointmentSignaturePointFromEvent({
        frame: { height: 240, width: 320, x: 20, y: 100 },
        pageX: 500,
        pageY: 500,
      }),
    ).toEqual({ x: 320, y: 240 });
  });

  it('uses the approved dark stroke colour and solid line width', () => {
    expect(APPOINTMENT_SIGNATURE_STROKE_COLOUR).toBe('#111827');
    expect(APPOINTMENT_SIGNATURE_STROKE_WIDTH).toBe(4);
  });

  it('clears all stored paths without changing the signature pad dimensions', () => {
    const cleared = clearAppointmentSignatureData(signatureData);

    expect(cleared.strokes).toEqual([]);
    expect(cleared.width).toBe(signatureData.width);
    expect(cleared.height).toBe(signatureData.height);
    expect(buildAppointmentSignatureStrokeSegments(cleared)).toEqual([]);
  });

  it('reloads saved structured stroke JSON into the same continuous segments', () => {
    const savedJson = JSON.stringify(signatureData);
    const reloaded = JSON.parse(savedJson) as AppointmentSignatureData;

    expect(buildAppointmentSignatureStrokeSegments(reloaded)).toEqual(
      buildAppointmentSignatureStrokeSegments(signatureData),
    );
  });

  it('keeps signature presence validation based on stored strokes', () => {
    expect(hasAppointmentSignatureStrokes(signatureData)).toBe(true);
    expect(
      hasAppointmentSignatureStrokes({
        strokes: [[]],
      }),
    ).toBe(false);
  });

  it('locks parent modal scrolling only while the customer is signing', () => {
    expect(isAppointmentCompletionSignatureScrollEnabled(false)).toBe(true);
    expect(isAppointmentCompletionSignatureScrollEnabled(true)).toBe(false);
  });

  it('documents the completion signature spacing contract', () => {
    expect(APPOINTMENT_SIGNATURE_ACTION_GAP).toBe(16);
    expect(APPOINTMENT_SIGNATURE_SKIP_REASON_TOP_SPACING).toBe(24);
    expect(APPOINTMENT_SIGNATURE_SKIP_REASON_INPUT_GAP).toBe(10);
    expect(APPOINTMENT_SIGNATURE_SKIP_REASON_BUTTON_GAP).toBe(14);
  });

  it('builds structured authorised skip reasons and requires an Other explanation', () => {
    expect(
      buildAppointmentSignatureSkipReason({
        reason: 'Customer unavailable',
      }),
    ).toBe('Customer unavailable');
    expect(buildAppointmentSignatureSkipReason({ reason: 'Other' })).toBe('');
    expect(
      buildAppointmentSignatureSkipReason({
        explanation: 'Emergency after-hours visit approved by office.',
        reason: 'Other',
      }),
    ).toBe('Other: Emergency after-hours visit approved by office.');
  });

  it('wires the mobile signature pad to measured page coordinates and locks parent scrolling while signing', () => {
    const appointmentDetails = mobileSource(
      'screens/AppointmentDetailsScreen.tsx',
    );

    expect(appointmentDetails).toContain(
      'appointmentSignaturePointFromEvent({',
    );
    expect(appointmentDetails).toContain('pageX: event.nativeEvent.pageX');
    expect(appointmentDetails).toContain('pageY: event.nativeEvent.pageY');
    expect(appointmentDetails).toContain('padRef.current?.measureInWindow');
    expect(appointmentDetails).toContain(
      'scrollEnabled={isAppointmentCompletionSignatureScrollEnabled(',
    );
  });

  it('shows explicit signature capture and authorised skip paths in the completion modal', () => {
    const appointmentDetails = mobileSource(
      'screens/AppointmentDetailsScreen.tsx',
    );
    const appointmentService = readFileSync(
      join(
        repoRoot,
        'apps',
        'api',
        'src',
        'appointments',
        'appointments.service.ts',
      ),
      'utf8',
    );

    expect(appointmentDetails).toContain('Capture signature');
    expect(appointmentDetails).toContain('Skip signature');
    expect(appointmentDetails).toContain("typeof SIGNATURE_SKIP_OPTION | ''");
    expect(appointmentDetails).toContain("setSignOffMode('')");
    expect(appointmentDetails).toContain('styles.captureSignatureButton');
    expect(appointmentDetails).toContain('styles.skipSignatureSecondaryButton');
    expect(appointmentDetails).toContain(
      'signOffMode !== SIGNATURE_CAPTURE_OPTION',
    );
    expect(appointmentDetails).toContain(
      'APPOINTMENT_SIGNATURE_SKIP_REASONS.map',
    );
    expect(appointmentDetails).toContain("skipReason === 'Other'");
    expect(appointmentDetails).toContain('Save skip reason');
    expect(appointmentDetails).toContain("label: 'Customer sign-off'");
    expect(appointmentDetails).toContain(
      "`Skipped: ${appointment.signature.skipReason ?? 'Reason recorded'}`",
    );
    expect(appointmentService).toContain(
      'const SIGNATURE_SKIP_ROLES = APPOINTMENT_STATUS_UPDATE_ROLES;',
    );
  });
});
