import type { MediaCategory, MediaType } from '@tradieos/shared';
import { mediaCategoryLabel, mediaTypeLabel } from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  AppState,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ApiRequestError,
  cancelMediaUploadRequest,
  createMediaUploadTargetRequest,
  uploadLocalMediaRequest,
  uploadLocalMediaFileRequest,
} from '../api/client';
import type {
  EvidenceSource,
  MediaPickerControllerState,
} from '../api/mediaPickerController';
import {
  closeEvidenceSourceMenu,
  initialMediaPickerControllerState,
  openEvidenceSourceMenu,
  openingLabelForSource,
  pickerLaunchFinished,
  pickerLaunchStarted,
  pickerNativeCallStarted,
  pickerPermissionStarted,
  resetMediaPickerController,
  selectEvidenceSource as selectEvidenceSourceState,
} from '../api/mediaPickerController';
import {
  MAX_PHOTO_SELECTION,
  categoriesForMediaType,
  formatFileSize,
  friendlyUploadError,
  isPickerCancelled,
  isCategoryValidForMediaType,
  normaliseMimeType,
  uploadButtonLabel,
  validateMediaSelection,
} from '../api/mediaSelection';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

declare const __DEV__: boolean;

type Props = NativeStackScreenProps<RootStackParamList, 'MediaEvidence'>;

type EvidenceStatus =
  'ready' | 'uploading' | 'uploaded' | 'failed' | 'cancelled';

type EvidenceFile = {
  id: string;
  category: MediaCategory;
  error?: string;
  fileName: string;
  fileSizeBytes: number;
  height?: number | null;
  mediaId?: string;
  mediaType: MediaType;
  mimeType: string;
  progress: number;
  source: 'camera' | 'library' | 'document' | 'demo';
  status: EvidenceStatus;
  uri: string;
  width?: number | null;
};

const demoPhotoBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const demoPdfBase64 =
  'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1szIDAgUl0+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMTIwIDgwXS9Db250ZW50cyA0IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMTIgVGYgMTAgNDAgVGQgKFRyYWRpZU9TIGRlbW8gbWVkaWEpIFRqIEVUCmVuZHN0cmVhbSBlbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+PgolJUVPRg==';

const supportedDocumentMimeTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

const documentPickerType =
  Platform.OS === 'ios' ? '*/*' : supportedDocumentMimeTypes;

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uriFileName(uri: string) {
  const clean = uri.split('?')[0] ?? uri;
  return decodeURIComponent(clean.split('/').pop() || 'tradieos-evidence');
}

function firstCategoryForFiles(files: EvidenceFile[]) {
  return files[0]?.category ?? 'BEFORE_PHOTO';
}

function isTemporaryCacheFile(uri: string) {
  return Boolean(
    FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory),
  );
}

async function safeDeleteTemporaryFile(uri: string) {
  if (!isTemporaryCacheFile(uri)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
    () => undefined,
  );
}

function evidenceIcon(mediaType: MediaType) {
  if (mediaType === 'IMAGE') return '📷';
  if (mediaType === 'PDF') return '📄';
  return '📎';
}

function statusLabel(status: EvidenceStatus) {
  if (status === 'ready') return 'Ready';
  if (status === 'uploading') return 'Uploading';
  if (status === 'uploaded') return 'Uploaded';
  if (status === 'failed') return 'Needs retry';
  return 'Cancelled';
}

function statusBadgeStyle(status: EvidenceStatus) {
  if (status === 'ready') return styles.readyBadge;
  if (status === 'uploading') return styles.uploadingBadge;
  if (status === 'uploaded') return styles.uploadedBadge;
  if (status === 'failed') return styles.failedBadge;
  return styles.cancelledBadge;
}

async function fileSizeForUri(uri: string, fallback?: number | null) {
  if (fallback && fallback > 0) return fallback;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return 'size' in info ? info.size : null;
  } catch {
    return null;
  }
}

function developmentMediaLog(event: string, details: Record<string, unknown>) {
  if (!__DEV__) return;
  console.info(`[TradieOS media:${event}]`, details);
}

function developmentPickerError(error: unknown, result?: unknown) {
  if (!__DEV__) return;
  const err = error as { message?: string; name?: string; stack?: string };
  console.info('[TradieOS media:document-picker-error]', {
    errorMessage: err?.message,
    errorName: err?.name,
    platform: Platform.OS,
    resultShape: result
      ? {
          hasAssets: Array.isArray((result as { assets?: unknown }).assets),
          keys: Object.keys(result as Record<string, unknown>),
        }
      : null,
    sdk: '54.0.0',
    stack: err?.stack,
  });
}

function developmentPickerLog(event: string, details: Record<string, unknown>) {
  if (!__DEV__) return;
  console.info(`[TradieOS media:picker:${event}]`, {
    at: new Date().toISOString(),
    ...details,
  });
}

export function MediaEvidenceScreen({ navigation, route }: Props) {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const cancelledIds = useRef(new Set<string>());
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [category, setCategory] = useState<MediaCategory>('BEFORE_PHOTO');
  const [caption, setCaption] = useState('');
  const [notes, setNotes] = useState('');
  const [isCustomerVisible, setIsCustomerVisible] = useState(false);
  const [pickerState, setPickerState] = useState<MediaPickerControllerState>(
    initialMediaPickerControllerState,
  );
  const [isUploading, setIsUploading] = useState(false);
  const isUploadingRef = useRef(false);
  const pickerStateRef = useRef(pickerState);
  const isMountedRef = useRef(true);
  const pendingSourceRef = useRef<EvidenceSource | null>(null);
  const launchInProgressRef = useRef(false);
  const nativePickerCalledRef = useRef(false);
  const launchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackLaunchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActionMenuOpen = pickerState.isSourceMenuOpen;
  const isLaunchingPicker = pickerState.isLaunchingPicker;
  const openingPickerLabel = isLaunchingPicker
    ? openingLabelForSource(pickerState.activePicker)
    : '+ Add evidence';

  const canSetCustomerVisible = ['OWNER', 'ADMIN', 'OFFICE_MANAGER'].includes(
    user?.role ?? '',
  );
  const hasMediaContext = Boolean(
    route.params?.appointmentId ||
    route.params?.jobId ||
    route.params?.customerId,
  );
  const activeFiles = files.filter((file) => file.status !== 'cancelled');
  const uploadableFiles = activeFiles.filter((file) =>
    ['ready', 'failed'].includes(file.status),
  );
  const overallProgress = useMemo(() => {
    if (!activeFiles.length) return 0;
    const total = activeFiles.reduce((sum, file) => sum + file.progress, 0);
    return Math.round(total / activeFiles.length);
  }, [activeFiles]);
  const visibleCategories = useMemo(
    () => categoriesForMediaType(activeFiles[0]?.mediaType ?? 'IMAGE'),
    [activeFiles],
  );

  useEffect(() => {
    pickerStateRef.current = pickerState;
  }, [pickerState]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      resetPickerState('navigation-blur');
    });
    const unsubscribeFocus = navigation.addListener('focus', () => {
      if (
        !launchInProgressRef.current &&
        pickerStateRef.current.isLaunchingPicker
      ) {
        resetPickerState('navigation-focus-stale');
      }
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (
          state === 'active' &&
          !launchInProgressRef.current &&
          pickerStateRef.current.isLaunchingPicker
        ) {
          resetPickerState('app-active-stale');
        }
      },
    );

    return () => {
      unsubscribe();
      unsubscribeFocus();
      appStateSubscription.remove();
      isMountedRef.current = false;
      resetPickerState('unmount', false);
    };
  }, [navigation]);

  function updatePickerState(
    next:
      | MediaPickerControllerState
      | ((current: MediaPickerControllerState) => MediaPickerControllerState),
  ) {
    if (typeof next !== 'function') {
      pickerStateRef.current = next;
      setPickerState(next);
      return;
    }

    setPickerState((current) => {
      const resolved = next(current);
      pickerStateRef.current = resolved;
      return resolved;
    });
  }

  function pickerLogState(extra: Record<string, unknown> = {}) {
    const state = pickerStateRef.current;
    return {
      activePicker: state.activePicker,
      isLaunchingPicker: state.isLaunchingPicker,
      pendingSource: pendingSourceRef.current ?? state.pendingSource,
      phase: state.phase,
      sourceSheetVisible: state.isSourceMenuOpen,
      ...extra,
    };
  }

  function clearLaunchTimer() {
    if (!launchTimerRef.current) return;
    clearTimeout(launchTimerRef.current);
    launchTimerRef.current = null;
  }

  function clearFallbackLaunchTimer() {
    if (!fallbackLaunchTimerRef.current) return;
    clearTimeout(fallbackLaunchTimerRef.current);
    fallbackLaunchTimerRef.current = null;
  }

  function clearWatchdogTimer() {
    if (!watchdogTimerRef.current) return;
    clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = null;
  }

  function resetPickerState(reason: string, shouldCommit = true) {
    clearLaunchTimer();
    clearFallbackLaunchTimer();
    clearWatchdogTimer();
    pendingSourceRef.current = null;
    launchInProgressRef.current = false;
    nativePickerCalledRef.current = false;
    pickerStateRef.current = resetMediaPickerController();
    if (shouldCommit) {
      setPickerState(resetMediaPickerController());
    }
    developmentPickerLog(
      reason.startsWith('watchdog') ? 'WATCHDOG_RESET' : 'PICKER_STATE_RESET',
      pickerLogState({ reason }),
    );
  }

  function syncCategory(nextFiles: EvidenceFile[]) {
    const nextCategory = firstCategoryForFiles(nextFiles);
    const firstFile = nextFiles[0];
    setCategory((current) =>
      firstFile && !isCategoryValidForMediaType(firstFile.mediaType, current)
        ? nextCategory
        : current,
    );
  }

  function addFiles(nextFiles: EvidenceFile[]) {
    if (!nextFiles.length) return;
    setFiles((current) => {
      const merged = [...current, ...nextFiles];
      syncCategory(merged);
      return merged;
    });
    updatePickerState((current) => ({
      ...current,
      isSourceMenuOpen: false,
      pendingSource: null,
    }));
  }

  async function createEvidenceFile(input: {
    fileName?: string | null;
    fileSizeBytes?: number | null;
    height?: number | null;
    mimeType?: string | null;
    source: EvidenceFile['source'];
    uri: string;
    width?: number | null;
  }): Promise<EvidenceFile | null> {
    const fileName = input.fileName || uriFileName(input.uri);
    const fileSizeBytes = await fileSizeForUri(input.uri, input.fileSizeBytes);
    const validation = validateMediaSelection({
      fileName,
      fileSizeBytes,
      mimeType: normaliseMimeType(input.mimeType, fileName),
    });
    if (!validation.ok) {
      showToast({ message: validation.message, tone: 'error' });
      return null;
    }

    return {
      category: validation.category,
      fileName,
      fileSizeBytes: fileSizeBytes ?? 0,
      height: input.height,
      id: createId(),
      mediaType: validation.mediaType,
      mimeType: validation.mimeType,
      progress: 0,
      source: input.source,
      status: 'ready',
      uri: input.uri,
      width: input.width,
    };
  }

  function openActionMenu() {
    developmentPickerLog('ADD_EVIDENCE_PRESSED', pickerLogState());
    if (Platform.OS === 'ios') {
      openIosActionSheet();
      return;
    }

    updatePickerState((current) => {
      const next = openEvidenceSourceMenu(current);
      developmentPickerLog(
        'SOURCE_SHEET_OPEN_REQUESTED',
        pickerLogState({
          blocked: next === current,
          isLaunchingPicker: current.isLaunchingPicker,
        }),
      );
      return next;
    });
  }

  function openIosActionSheet() {
    if (launchInProgressRef.current) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 3,
        options: ['Take photo', 'Choose photos', 'Choose document', 'Cancel'],
        title: 'Add evidence',
      },
      (buttonIndex) => {
        if (buttonIndex === 0) {
          selectEvidenceSource('CAMERA');
        } else if (buttonIndex === 1) {
          selectEvidenceSource('PHOTO_LIBRARY');
        } else if (buttonIndex === 2) {
          selectEvidenceSource('DOCUMENT');
        } else {
          closeActionMenu();
        }
      },
    );
  }

  function closeActionMenu() {
    updatePickerState((current) => {
      pendingSourceRef.current = null;
      developmentPickerLog('SHEET_CLOSE_REQUESTED', pickerLogState());
      return closeEvidenceSourceMenu(current);
    });
  }

  function selectEvidenceSource(source: EvidenceSource) {
    if (launchInProgressRef.current) {
      developmentPickerLog(
        'SOURCE_SELECTED',
        pickerLogState({ blocked: true, source }),
      );
      return;
    }

    const current = pickerStateRef.current;
    const next = selectEvidenceSourceState(current, source);
    pendingSourceRef.current = source;
    pickerStateRef.current = next;
    setPickerState(next);
    developmentPickerLog('SOURCE_SELECTED', pickerLogState({ source }));
    developmentPickerLog('SHEET_CLOSE_REQUESTED', pickerLogState({ source }));
    developmentPickerLog('SHEET_VISIBLE_FALSE', pickerLogState({ source }));
    if (Platform.OS === 'ios') {
      developmentPickerLog('MODAL_ON_DISMISS', {
        ...pickerLogState({ source }),
        implementation: 'ActionSheetIOS',
      });
    }
    developmentPickerLog('SOURCE_SELECTED_RESULT', {
      blocked: next === current,
      source,
    });
    schedulePendingPickerLaunch('option-pressed');
  }

  function schedulePendingPickerLaunch(reason: string) {
    clearLaunchTimer();
    clearFallbackLaunchTimer();
    developmentPickerLog(
      'PICKER_LAUNCH_SCHEDULED',
      pickerLogState({ path: 'primary', reason }),
    );

    requestAnimationFrame(() => {
      InteractionManager.runAfterInteractions(() => {
        launchTimerRef.current = setTimeout(() => {
          launchTimerRef.current = null;
          launchPendingSource(`primary:${reason}`);
        }, 0);
      });
    });

    fallbackLaunchTimerRef.current = setTimeout(() => {
      fallbackLaunchTimerRef.current = null;
      developmentPickerLog(
        'PICKER_LAUNCH_SCHEDULED',
        pickerLogState({ path: 'fallback', reason }),
      );
      launchPendingSource(`fallback:${reason}`);
    }, 400);
  }

  function handleActionMenuDismissed() {
    developmentPickerLog('MODAL_ON_DISMISS', pickerLogState());
    if (pendingSourceRef.current) {
      schedulePendingPickerLaunch('modal-dismissed');
    }
  }

  function launchPendingSource(reason: string) {
    const source = pendingSourceRef.current;
    if (!source || launchInProgressRef.current || !isMountedRef.current) {
      developmentPickerLog(
        'PICKER_LAUNCH_SKIPPED',
        pickerLogState({
          hasSource: Boolean(source),
          isMounted: isMountedRef.current,
          launchInProgress: launchInProgressRef.current,
          reason,
        }),
      );
      return;
    }

    pendingSourceRef.current = null;
    clearLaunchTimer();
    clearFallbackLaunchTimer();
    launchInProgressRef.current = true;
    nativePickerCalledRef.current = false;

    const current = pickerStateRef.current;
    updatePickerState(pickerLaunchStarted(current, source));
    startPickerWatchdog(source);
    developmentPickerLog(
      'PICKER_LAUNCH_STARTED',
      pickerLogState({ reason, source }),
    );
    void launchEvidencePicker(source);
  }

  async function launchEvidencePicker(source: EvidenceSource) {
    try {
      if (source === 'CAMERA') {
        await takePhoto();
      } else if (source === 'PHOTO_LIBRARY') {
        await choosePhotos();
      } else {
        await chooseDocument();
      }
    } finally {
      clearWatchdogTimer();
      launchInProgressRef.current = false;
      nativePickerCalledRef.current = false;
      updatePickerState((state) => pickerLaunchFinished(state));
      developmentPickerLog('PICKER_FINALLY', pickerLogState({ source }));
    }
  }

  function startPickerWatchdog(source: EvidenceSource) {
    clearWatchdogTimer();
    watchdogTimerRef.current = setTimeout(() => {
      if (!launchInProgressRef.current || nativePickerCalledRef.current) return;
      showToast({
        message: "We couldn't open the picker. Please try again.",
        tone: 'error',
      });
      resetPickerState(`watchdog:${source}`);
    }, 9000);
  }

  async function takePhoto() {
    try {
      updatePickerState((state) => pickerPermissionStarted(state));
      developmentPickerLog('PERMISSION_REQUEST_STARTED', {
        ...pickerLogState({ source: 'CAMERA' }),
        permission: 'camera',
      });
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      developmentPickerLog('PERMISSION_REQUEST_FINISHED', {
        ...pickerLogState({
          granted: permission.granted,
          source: 'CAMERA',
        }),
        permission: 'camera',
      });
      if (!permission.granted) {
        showToast({
          message:
            'Camera permission denied. Enable camera access in Settings to take evidence photos.',
          tone: 'error',
        });
        return;
      }
      nativePickerCalledRef.current = true;
      clearWatchdogTimer();
      updatePickerState((state) => pickerNativeCallStarted(state, 'CAMERA'));
      developmentPickerLog('NATIVE_PICKER_CALLED', {
        ...pickerLogState({ source: 'CAMERA' }),
        picker: 'camera',
      });
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        exif: false,
        mediaTypes: ['images'],
        quality: 0.9,
      });
      developmentPickerLog('NATIVE_PICKER_RETURNED', {
        ...pickerLogState({ source: 'CAMERA' }),
        assetCount: result.assets?.length ?? 0,
        canceled: result.canceled,
        picker: 'camera',
      });
      developmentPickerLog('camera-result', {
        assetCount: result.assets?.length ?? 0,
        canceled: result.canceled,
      });
      if (result.canceled || !result.assets?.length) {
        developmentPickerLog('native-cancelled', { source: 'CAMERA' });
        return;
      }
      const asset = result.assets[0];
      if (!asset) return;
      const file = await createEvidenceFile({
        fileName: asset.fileName,
        fileSizeBytes: asset.fileSize,
        height: asset.height,
        mimeType: asset.mimeType,
        source: 'camera',
        uri: asset.uri,
        width: asset.width,
      });
      if (file) addFiles([file]);
    } catch (error) {
      developmentPickerLog('PICKER_ERROR', {
        ...pickerLogState({ source: 'CAMERA' }),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        picker: 'camera',
      });
      showToast({
        message: "We couldn't open the camera. Please try again.",
        tone: 'error',
      });
    }
  }

  async function choosePhotos() {
    try {
      updatePickerState((state) => pickerPermissionStarted(state));
      developmentPickerLog('PERMISSION_REQUEST_STARTED', {
        ...pickerLogState({ source: 'PHOTO_LIBRARY' }),
        permission: 'photo-library',
      });
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      developmentPickerLog('PERMISSION_REQUEST_FINISHED', {
        ...pickerLogState({
          granted: permission.granted,
          source: 'PHOTO_LIBRARY',
        }),
        permission: 'photo-library',
      });
      if (!permission.granted) {
        showToast({
          message:
            'Photo library permission denied. Enable photo access in Settings to choose evidence.',
          tone: 'error',
        });
        return;
      }
      nativePickerCalledRef.current = true;
      clearWatchdogTimer();
      updatePickerState((state) =>
        pickerNativeCallStarted(state, 'PHOTO_LIBRARY'),
      );
      developmentPickerLog('NATIVE_PICKER_CALLED', {
        ...pickerLogState({ source: 'PHOTO_LIBRARY' }),
        picker: 'photo-library',
      });
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images'],
        quality: 0.9,
        selectionLimit: MAX_PHOTO_SELECTION,
      });
      developmentPickerLog('NATIVE_PICKER_RETURNED', {
        ...pickerLogState({ source: 'PHOTO_LIBRARY' }),
        assetCount: result.assets?.length ?? 0,
        canceled: result.canceled,
        picker: 'photo-library',
      });
      developmentPickerLog('photo-library-result', {
        assetCount: result.assets?.length ?? 0,
        canceled: result.canceled,
      });
      if (result.canceled || !result.assets?.length) {
        developmentPickerLog('native-cancelled', { source: 'PHOTO_LIBRARY' });
        return;
      }
      const nextFiles = await Promise.all(
        result.assets.slice(0, MAX_PHOTO_SELECTION).map((asset) =>
          createEvidenceFile({
            fileName: asset.fileName,
            fileSizeBytes: asset.fileSize,
            height: asset.height,
            mimeType: asset.mimeType,
            source: 'library',
            uri: asset.uri,
            width: asset.width,
          }),
        ),
      );
      addFiles(nextFiles.filter((file): file is EvidenceFile => Boolean(file)));
    } catch (error) {
      developmentPickerLog('PICKER_ERROR', {
        ...pickerLogState({ source: 'PHOTO_LIBRARY' }),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        picker: 'photo-library',
      });
      showToast({
        message: "We couldn't open your photo library. Please try again.",
        tone: 'error',
      });
    }
  }

  async function chooseDocument() {
    try {
      nativePickerCalledRef.current = true;
      clearWatchdogTimer();
      updatePickerState((state) => pickerNativeCallStarted(state, 'DOCUMENT'));
      developmentPickerLog('NATIVE_PICKER_CALLED', {
        ...pickerLogState({ source: 'DOCUMENT' }),
        picker: 'document',
      });
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: documentPickerType,
      });
      developmentPickerLog('NATIVE_PICKER_RETURNED', {
        ...pickerLogState({ source: 'DOCUMENT' }),
        assetCount: result.assets?.length ?? 0,
        canceled: result.canceled,
        picker: 'document',
      });
      developmentMediaLog('document-picker-result', {
        assetCount: result.assets?.length ?? 0,
        canceled: result.canceled,
        platform: Platform.OS,
      });
      if (isPickerCancelled(result) || !result.assets?.length) {
        developmentPickerLog('native-cancelled', { source: 'DOCUMENT' });
        return;
      }
      const asset = result.assets[0];
      if (!asset) return;
      const file = await createEvidenceFile({
        fileName: asset.name,
        fileSizeBytes: asset.size,
        mimeType: asset.mimeType,
        source: 'document',
        uri: asset.uri,
      });
      if (file) addFiles([file]);
    } catch (error) {
      developmentPickerError(error);
      developmentPickerLog('PICKER_ERROR', {
        ...pickerLogState({ source: 'DOCUMENT' }),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        picker: 'document',
      });
      showToast({
        message: "We couldn't open the document picker. Please try again.",
        tone: 'error',
      });
    }
  }

  async function addDemoEvidence() {
    const isDocument = activeFiles.some((file) => file.mediaType !== 'IMAGE');
    addFiles([
      {
        category: isDocument ? 'GENERAL_DOCUMENT' : 'BEFORE_PHOTO',
        fileName: isDocument
          ? 'tradieos-demo-document.pdf'
          : 'tradieos-demo-photo.png',
        fileSizeBytes: isDocument ? 301 : 68,
        height: isDocument ? null : 1,
        id: createId(),
        mediaType: isDocument ? 'PDF' : 'IMAGE',
        mimeType: isDocument ? 'application/pdf' : 'image/png',
        progress: 0,
        source: 'demo',
        status: 'ready',
        uri: `demo://${Date.now()}`,
        width: isDocument ? null : 1,
      },
    ]);
  }

  function removeFile(fileId: string) {
    const file = files.find((item) => item.id === fileId);
    if (file) {
      if (token && file.mediaId && file.status !== 'uploaded') {
        void cancelMediaUploadRequest(token, file.mediaId).catch(
          () => undefined,
        );
      }
      void safeDeleteTemporaryFile(file.uri);
    }
    setFiles((current) => {
      const next = current.filter((item) => item.id !== fileId);
      syncCategory(next);
      return next;
    });
  }

  async function cancelFile(file: EvidenceFile) {
    cancelledIds.current.add(file.id);
    setFiles((current) =>
      current.map((item) =>
        item.id === file.id
          ? { ...item, progress: 0, status: 'cancelled' }
          : item,
      ),
    );
    if (token && file.mediaId) {
      await cancelMediaUploadRequest(token, file.mediaId).catch(
        () => undefined,
      );
    }
    await safeDeleteTemporaryFile(file.uri);
  }

  function updateFileCategory(fileId: string, nextCategory: MediaCategory) {
    setFiles((current) =>
      current.map((file) =>
        file.id === fileId ? { ...file, category: nextCategory } : file,
      ),
    );
    setCategory(nextCategory);
  }

  function updateSharedCategory(nextCategory: MediaCategory) {
    setCategory(nextCategory);
    setFiles((current) =>
      current.map((file) =>
        isCategoryValidForMediaType(file.mediaType, nextCategory)
          ? { ...file, category: nextCategory }
          : file,
      ),
    );
  }

  function updateFile(fileId: string, patch: Partial<EvidenceFile>) {
    setFiles((current) =>
      current.map((file) =>
        file.id === fileId ? { ...file, ...patch } : file,
      ),
    );
  }

  async function uploadFile(file: EvidenceFile) {
    if (!token) return false;
    if (cancelledIds.current.has(file.id)) return false;
    updateFile(file.id, { error: undefined, progress: 8, status: 'uploading' });
    let mediaId = file.mediaId;
    try {
      if (!mediaId) {
        const target = await createMediaUploadTargetRequest(token, {
          appointmentId: route.params?.appointmentId,
          caption,
          category: file.category,
          customerId: route.params?.customerId,
          fileSizeBytes: file.fileSizeBytes,
          height: file.height,
          isCustomerVisible,
          jobId: route.params?.jobId,
          mediaType: file.mediaType,
          mimeType: file.mimeType,
          notes,
          originalFileName: file.fileName,
          width: file.width,
        });
        mediaId = target.media.id;
      }
      updateFile(file.id, { mediaId, progress: 28 });
      if (cancelledIds.current.has(file.id)) {
        await cancelMediaUploadRequest(token, mediaId).catch(() => undefined);
        return false;
      }
      const contentBase64 =
        file.mediaType === 'IMAGE' ? demoPhotoBase64 : demoPdfBase64;
      updateFile(file.id, { progress: 72 });
      if (cancelledIds.current.has(file.id)) {
        await cancelMediaUploadRequest(token, mediaId).catch(() => undefined);
        return false;
      }
      if (file.source === 'demo') {
        await uploadLocalMediaRequest(token, mediaId, { contentBase64 });
      } else {
        developmentMediaLog('upload-prepared-file', {
          fileName: file.fileName,
          mediaType: file.mediaType,
          mimeType: file.mimeType,
          preparedByteSize: file.fileSizeBytes,
          preparedUriScheme: file.uri.split(':')[0],
          uploadMethod: 'multipart/form-data',
        });
        await uploadLocalMediaFileRequest(token, mediaId, {
          name: file.fileName,
          type: file.mimeType,
          uri: file.uri,
        });
      }
      updateFile(file.id, { progress: 100, status: 'uploaded' });
      await safeDeleteTemporaryFile(file.uri);
      return true;
    } catch (error) {
      updateFile(file.id, {
        error: friendlyUploadError({
          code: error instanceof ApiRequestError ? error.code : null,
          mediaType: file.mediaType,
          message: error instanceof Error ? error.message : null,
        }),
        mediaId,
        progress: 0,
        status: 'failed',
      });
      return false;
    }
  }

  async function uploadEvidence() {
    if (!token || isUploadingRef.current) return;
    if (!hasMediaContext) {
      showToast({
        message:
          'Open evidence from My Day, an appointment, job or customer first.',
        tone: 'error',
      });
      return;
    }
    if (!uploadableFiles.length) {
      showToast({
        message: 'Choose evidence before uploading.',
        tone: 'warning',
      });
      return;
    }
    isUploadingRef.current = true;
    setIsUploading(true);
    cancelledIds.current.clear();
    let failedCount = 0;
    try {
      for (const file of uploadableFiles) {
        const ok = await uploadFile(file);
        if (!ok) failedCount += 1;
      }
    } finally {
      isUploadingRef.current = false;
      setIsUploading(false);
    }

    if (failedCount > 0) {
      showToast({
        message: 'Some evidence could not upload. Use Retry on failed files.',
        tone: 'warning',
      });
      return;
    }
    showToast({ message: 'Evidence uploaded.', tone: 'success' });
    navigation.goBack();
  }

  function openSettings() {
    void Linking.openSettings?.();
  }

  return (
    <KeyboardAvoidingView
      behavior={keyboardAvoidingBehavior}
      style={styles.host}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>Photos & documents</Text>
        <Text style={styles.title}>Add job evidence</Text>
        <Text style={styles.subtitle}>
          Capture photos or attach documents for this appointment, job or
          customer. Nothing is sent to customers unless you confirm it later.
        </Text>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={isLaunchingPicker || isUploading}
            onPress={openActionMenu}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>{openingPickerLabel}</Text>
          </Pressable>
          <Pressable onPress={openSettings} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Permissions</Text>
          </Pressable>
        </View>
        {__DEV__ && isLaunchingPicker ? (
          <Text style={styles.diagnosticText}>
            Picker state: {pickerState.phase.toLowerCase().replace(/_/g, ' ')}
          </Text>
        ) : null}

        {!hasMediaContext ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>No context selected</Text>
            <Text style={styles.muted}>
              Open this screen from My Day, Appointment Details, Job Details or
              Customer Details before uploading evidence.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Shared caption</Text>
          <TextInput
            onChangeText={setCaption}
            placeholder="e.g. Before photo of switchboard"
            placeholderTextColor={colours.muted}
            style={styles.input}
            value={caption}
          />
          <Text style={styles.label}>Shared notes</Text>
          <TextInput
            multiline
            onChangeText={setNotes}
            placeholder="Internal notes for the job timeline"
            placeholderTextColor={colours.muted}
            style={[styles.input, styles.textArea]}
            value={notes}
          />
          {canSetCustomerVisible ? (
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.label}>Visible to customer</Text>
                <Text style={styles.muted}>
                  Default is private to your team.
                </Text>
              </View>
              <Switch
                onValueChange={setIsCustomerVisible}
                value={isCustomerVisible}
              />
            </View>
          ) : null}
        </View>

        {activeFiles.length ? (
          <View style={styles.card}>
            <Text style={styles.label}>Category</Text>
            <Text style={styles.muted}>
              Categories adapt to the first selected file type. You can adjust
              each file below.
            </Text>
            <View style={styles.chips}>
              {visibleCategories.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => updateSharedCategory(item)}
                  style={[
                    styles.chip,
                    category === item ? styles.chipActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      category === item ? styles.chipTextActive : null,
                    ]}
                  >
                    {mediaCategoryLabel(item)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Review before upload</Text>
          <Text style={styles.muted}>
            {activeFiles.length
              ? `${activeFiles.length} selected`
              : 'No files selected yet'}
          </Text>
        </View>

        {activeFiles.length ? (
          activeFiles.map((file) => (
            <View key={file.id} style={styles.fileCard}>
              <View style={styles.preview}>
                {file.mediaType === 'IMAGE' && file.source !== 'demo' ? (
                  <Image source={{ uri: file.uri }} style={styles.thumbnail} />
                ) : (
                  <Text style={styles.previewIcon}>
                    {evidenceIcon(file.mediaType)}
                  </Text>
                )}
              </View>
              <View style={styles.fileBody}>
                <Text numberOfLines={1} style={styles.fileName}>
                  {file.fileName}
                </Text>
                <Text style={styles.muted}>
                  {mediaTypeLabel(file.mediaType)} ·{' '}
                  {formatFileSize(file.fileSizeBytes)}
                </Text>
                <View style={styles.statusRow}>
                  <Text
                    style={[styles.statusBadge, statusBadgeStyle(file.status)]}
                  >
                    {statusLabel(file.status)}
                    {file.status === 'uploading' ? ` ${file.progress}%` : ''}
                  </Text>
                </View>
                {file.status === 'uploading' ? (
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${file.progress}%` },
                      ]}
                    />
                  </View>
                ) : null}
                {file.error ? (
                  <Text style={styles.errorText}>{file.error}</Text>
                ) : null}
                <View style={styles.smallChips}>
                  {categoriesForMediaType(file.mediaType).map((item) => (
                    <Pressable
                      key={item}
                      disabled={isUploading}
                      onPress={() => updateFileCategory(file.id, item)}
                      style={[
                        styles.smallChip,
                        file.category === item ? styles.smallChipActive : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.smallChipText,
                          file.category === item
                            ? styles.smallChipTextActive
                            : null,
                        ]}
                      >
                        {mediaCategoryLabel(item)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.fileActions}>
                  {file.status === 'failed' ? (
                    <Pressable
                      disabled={isUploading}
                      onPress={() => {
                        setFiles((current) =>
                          current.map((item) =>
                            item.id === file.id
                              ? { ...item, error: undefined, status: 'ready' }
                              : item,
                          ),
                        );
                      }}
                      style={styles.linkButton}
                    >
                      <Text style={styles.linkText}>Retry</Text>
                    </Pressable>
                  ) : null}
                  {file.status === 'uploading' ? (
                    <Pressable
                      onPress={() => void cancelFile(file)}
                      style={styles.linkButton}
                    >
                      <Text style={styles.dangerText}>Cancel</Text>
                    </Pressable>
                  ) : null}
                  {file.status !== 'uploading' ? (
                    <Pressable
                      disabled={isUploading}
                      onPress={() => removeFile(file.id)}
                      style={styles.linkButton}
                    >
                      <Text style={styles.dangerText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📎</Text>
            <Text style={styles.emptyTitle}>
              Add evidence when you’re ready
            </Text>
            <Text style={styles.muted}>
              Take a photo, choose up to {MAX_PHOTO_SELECTION} photos, or attach
              a PDF, Word, Excel or text document.
            </Text>
          </View>
        )}

        {isUploading ? (
          <View style={styles.progress}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.muted}>
              Uploading evidence... {overallProgress}%
            </Text>
          </View>
        ) : null}

        {__DEV__ ? (
          <Pressable
            disabled={isUploading}
            onPress={addDemoEvidence}
            style={styles.devButton}
          >
            <Text style={styles.secondaryText}>Add demo file (dev only)</Text>
          </Pressable>
        ) : null}

        <Pressable
          disabled={!uploadableFiles.length || isUploading || !hasMediaContext}
          onPress={uploadEvidence}
          style={[
            styles.primaryButton,
            !uploadableFiles.length || isUploading || !hasMediaContext
              ? styles.disabled
              : null,
          ]}
        >
          <Text style={styles.primaryText}>
            {isUploading
              ? `Uploading... ${overallProgress}%`
              : uploadButtonLabel(uploadableFiles.length)}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal
        animationType="fade"
        onDismiss={handleActionMenuDismissed}
        onRequestClose={closeActionMenu}
        transparent
        visible={isActionMenuOpen}
      >
        <Pressable
          accessibilityRole="button"
          onPress={closeActionMenu}
          style={styles.modalBackdrop}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={styles.menuCard}
          >
            <Text style={styles.menuTitle}>Add evidence</Text>
            <Pressable
              disabled={isLaunchingPicker}
              onPress={() => selectEvidenceSource('CAMERA')}
              style={styles.menuItem}
            >
              <Text style={styles.menuIcon}>📷</Text>
              <View>
                <Text style={styles.menuLabel}>Take photo</Text>
                <Text style={styles.muted}>
                  Use the camera for job evidence.
                </Text>
              </View>
            </Pressable>
            <Pressable
              disabled={isLaunchingPicker}
              onPress={() => selectEvidenceSource('PHOTO_LIBRARY')}
              style={styles.menuItem}
            >
              <Text style={styles.menuIcon}>🖼️</Text>
              <View>
                <Text style={styles.menuLabel}>Choose photos</Text>
                <Text style={styles.muted}>
                  Select up to {MAX_PHOTO_SELECTION} images.
                </Text>
              </View>
            </Pressable>
            <Pressable
              disabled={isLaunchingPicker}
              onPress={() => selectEvidenceSource('DOCUMENT')}
              style={styles.menuItem}
            >
              <Text style={styles.menuIcon}>📄</Text>
              <View>
                <Text style={styles.menuLabel}>Choose document</Text>
                <Text style={styles.muted}>
                  PDF, Word, Excel or text files.
                </Text>
              </View>
            </Pressable>
            <Pressable onPress={closeActionMenu} style={styles.cancelButton}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: 10 },
  cancelledBadge: { backgroundColor: '#F1F5F9', color: colours.muted },
  card: {
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 12,
    padding: 16,
  },
  cancelButton: {
    alignItems: 'center',
    borderRadius: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  chip: {
    backgroundColor: colours.background,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colours.primary },
  chipText: { color: colours.ink, fontWeight: '700' },
  chipTextActive: { color: '#FFFFFF' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  container: { gap: 16, padding: 20, paddingBottom: 40 },
  dangerText: { color: '#DC2626', fontWeight: '900' },
  devButton: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 48,
    padding: 14,
  },
  disabled: { opacity: 0.6 },
  diagnosticText: {
    color: colours.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 8,
    padding: 22,
  },
  emptyIcon: { fontSize: 30 },
  emptyTitle: { color: colours.ink, fontSize: 17, fontWeight: '900' },
  errorText: { color: '#DC2626', fontWeight: '800', lineHeight: 20 },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  failedBadge: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  fileActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fileBody: { flex: 1, gap: 8 },
  fileCard: {
    backgroundColor: colours.card,
    borderRadius: 22,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  fileName: { color: colours.ink, fontSize: 16, fontWeight: '900' },
  host: { backgroundColor: colours.background, flex: 1 },
  input: {
    backgroundColor: colours.background,
    borderRadius: 14,
    color: colours.ink,
    padding: 12,
  },
  label: { color: colours.ink, fontWeight: '800' },
  linkButton: { minHeight: 36, justifyContent: 'center' },
  linkText: { color: colours.primary, fontWeight: '900' },
  menuCard: {
    backgroundColor: colours.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 8,
    padding: 20,
    width: '100%',
  },
  menuIcon: { fontSize: 26, width: 34 },
  menuItem: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    padding: 12,
  },
  menuLabel: { color: colours.ink, fontSize: 16, fontWeight: '900' },
  menuTitle: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  modalBackdrop: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  muted: { color: colours.muted, lineHeight: 20 },
  preview: {
    alignItems: 'center',
    backgroundColor: colours.background,
    borderRadius: 18,
    height: 78,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 78,
  },
  previewIcon: { fontSize: 30 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 18,
    flex: 1,
    justifyContent: 'center',
    minHeight: 54,
    padding: 16,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '900', textAlign: 'center' },
  progress: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 18,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  progressFill: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  readyBadge: { backgroundColor: '#EEF2FF', color: colours.primary },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 54,
    padding: 14,
  },
  secondaryText: { color: colours.primary, fontWeight: '900' },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  smallChip: {
    backgroundColor: colours.background,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  smallChipActive: { backgroundColor: '#EEF2FF' },
  smallChipText: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  smallChipTextActive: { color: colours.primary },
  smallChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusRow: { flexDirection: 'row' },
  subtitle: { color: colours.muted, fontSize: 15, lineHeight: 22 },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  thumbnail: { height: '100%', width: '100%' },
  title: { color: colours.ink, fontSize: 28, fontWeight: '900' },
  toggleCopy: { flex: 1, paddingRight: 12 },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  uploadedBadge: { backgroundColor: '#DCFCE7', color: '#166534' },
  uploadingBadge: { backgroundColor: '#DBEAFE', color: '#1D4ED8' },
  warningCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  warningTitle: { color: '#92400E', fontWeight: '900' },
});
