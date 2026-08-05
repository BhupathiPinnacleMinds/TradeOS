import {
  APPOINTMENT_SIGNATURE_ACTION_GAP,
  APPOINTMENT_SIGNATURE_PAD_HEIGHT,
  APPOINTMENT_SIGNATURE_SKIP_REASON_BUTTON_GAP,
  APPOINTMENT_SIGNATURE_SKIP_REASON_INPUT_GAP,
  APPOINTMENT_SIGNATURE_SKIP_REASON_TOP_SPACING,
  APPOINTMENT_SIGNATURE_STROKE_COLOUR,
  APPOINTMENT_SIGNATURE_STROKE_WIDTH,
  buildAppointmentSignatureStrokeSegments,
  clearAppointmentSignatureData,
  hasAppointmentSignatureStrokes,
  isAppointmentCompletionSignatureScrollEnabled,
  type AppointmentSignatureData,
} from '@tradieos/shared';

describe('appointment signature rendering contract', () => {
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
});
