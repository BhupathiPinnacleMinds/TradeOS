export type EvidenceSource = 'CAMERA' | 'PHOTO_LIBRARY' | 'DOCUMENT';

export type PickerLaunchPhase =
  | 'IDLE'
  | 'CLOSING_SHEET'
  | 'REQUESTING_PERMISSION'
  | 'LAUNCHING_CAMERA'
  | 'LAUNCHING_PHOTOS'
  | 'LAUNCHING_DOCUMENTS';

export type MediaPickerControllerState = {
  activePicker: EvidenceSource | null;
  isLaunchingPicker: boolean;
  isSourceMenuOpen: boolean;
  phase: PickerLaunchPhase;
  pendingSource: EvidenceSource | null;
};

export const initialMediaPickerControllerState: MediaPickerControllerState = {
  activePicker: null,
  isLaunchingPicker: false,
  isSourceMenuOpen: false,
  phase: 'IDLE',
  pendingSource: null,
};

export function openEvidenceSourceMenu(
  state: MediaPickerControllerState,
): MediaPickerControllerState {
  if (state.isLaunchingPicker) return state;
  return { ...state, isSourceMenuOpen: true };
}

export function closeEvidenceSourceMenu(
  state: MediaPickerControllerState,
): MediaPickerControllerState {
  return {
    ...state,
    isSourceMenuOpen: false,
    phase: state.isLaunchingPicker ? state.phase : 'IDLE',
    pendingSource: null,
  };
}

export function selectEvidenceSource(
  state: MediaPickerControllerState,
  source: EvidenceSource,
): MediaPickerControllerState {
  if (state.isLaunchingPicker) return state;
  return {
    ...state,
    isSourceMenuOpen: false,
    phase: 'CLOSING_SHEET',
    pendingSource: source,
  };
}

export function pickerLaunchStarted(
  state: MediaPickerControllerState,
  source: EvidenceSource,
): MediaPickerControllerState {
  return {
    ...state,
    activePicker: source,
    isLaunchingPicker: true,
    isSourceMenuOpen: false,
    pendingSource: null,
    phase: openingPhaseForSource(source),
  };
}

export function pickerPermissionStarted(
  state: MediaPickerControllerState,
): MediaPickerControllerState {
  return { ...state, phase: 'REQUESTING_PERMISSION' };
}

export function pickerNativeCallStarted(
  state: MediaPickerControllerState,
  source: EvidenceSource,
): MediaPickerControllerState {
  return { ...state, phase: openingPhaseForSource(source) };
}

export function pickerLaunchFinished(
  state: MediaPickerControllerState,
): MediaPickerControllerState {
  return {
    ...state,
    activePicker: null,
    isLaunchingPicker: false,
    pendingSource: null,
    phase: 'IDLE',
  };
}

export function resetMediaPickerController(): MediaPickerControllerState {
  return initialMediaPickerControllerState;
}

export function openingLabelForSource(source: EvidenceSource | null) {
  if (source === 'CAMERA') return 'Opening camera...';
  if (source === 'PHOTO_LIBRARY') return 'Opening photos...';
  if (source === 'DOCUMENT') return 'Opening documents...';
  return '+ Add evidence';
}

function openingPhaseForSource(source: EvidenceSource): PickerLaunchPhase {
  if (source === 'CAMERA') return 'LAUNCHING_CAMERA';
  if (source === 'PHOTO_LIBRARY') return 'LAUNCHING_PHOTOS';
  return 'LAUNCHING_DOCUMENTS';
}
