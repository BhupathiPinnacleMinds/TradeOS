import type { MediaAsset } from '@tradieos/shared';
import {
  formatBusinessDateTime,
  mediaCategoryLabel,
  mediaDisplayTitle,
  mediaTypeLabel,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ApiRequestError,
  mediaDetailRequest,
  mediaDownloadRequest,
  mediaPreviewRequest,
} from '../api/client';
import { downloadAuthenticatedMediaFile } from '../api/mediaFiles';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

declare const __DEV__: boolean;

type Props = NativeStackScreenProps<RootStackParamList, 'MediaViewer'>;
type Point = { x: number; y: number };

const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SCALE = 2.5;
const MAX_ZOOM_SCALE = 4;
const SWIPE_CLOSE_DISTANCE = 110;

export function MediaViewerScreen({ navigation, route }: Props) {
  const { mediaId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const timezone = normaliseBusinessTimezone(user?.business.timezone);
  const [media, setMedia] = useState<MediaAsset | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [translate, setTranslate] = useState<Point>({ x: 0, y: 0 });
  const gestureStartRef = useRef<{
    distance: number;
    scale: number;
    translate: Point;
  } | null>(null);
  const lastTapRef = useRef(0);

  async function loadPreview(mediaItem: MediaAsset) {
    if (!token || mediaItem.mediaType !== 'IMAGE') return;
    setIsPreviewLoading(true);
    setPreviewUri(null);
    setPreviewError(null);
    try {
      await mediaPreviewRequest(token, mediaItem.id);
      setPreviewUri(
        await downloadAuthenticatedMediaFile(token, mediaItem, 'inline'),
      );
    } catch (error) {
      setPreviewError("We couldn't load this photo preview.");
      if (__DEV__) {
        console.warn('[TradieOS media preview failed]', {
          code: 'MEDIA_PREVIEW_FAILED',
          mediaId: mediaItem.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function loadMedia() {
    if (!token) return;
    setIsLoading(true);
    setPreviewUri(null);
    setPreviewError(null);
    setOpenError(null);
    try {
      const detail = await mediaDetailRequest(token, mediaId);
      setMedia(detail.media);
      navigation.setOptions({ title: mediaDisplayTitle(detail.media) });

      if (detail.media.mediaType === 'IMAGE') {
        await loadPreview(detail.media);
      }
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't load this file.",
        tone: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadMedia();
    }, [mediaId, token]),
  );

  const imageViewerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          isImageViewerOpen &&
          (zoomScale > 1 ||
            Math.abs(gestureState.dy) > 8 ||
            Math.abs(gestureState.dx) > 8),
        onPanResponderGrant: (event) => {
          const touches = event.nativeEvent.touches;
          gestureStartRef.current = {
            distance: getTouchDistance(touches),
            scale: zoomScale,
            translate,
          };
        },
        onPanResponderMove: (event, gestureState) => {
          const start = gestureStartRef.current;
          if (!start) return;

          const touches = event.nativeEvent.touches;
          if (touches.length >= 2 && start.distance > 0) {
            const nextScale = clamp(
              start.scale * (getTouchDistance(touches) / start.distance),
              1,
              MAX_ZOOM_SCALE,
            );
            setZoomScale(nextScale);
            if (nextScale === 1) setTranslate({ x: 0, y: 0 });
            return;
          }

          if (zoomScale > 1) {
            setTranslate({
              x: start.translate.x + gestureState.dx,
              y: start.translate.y + gestureState.dy,
            });
          } else if (gestureState.dy > 0) {
            setTranslate({ x: 0, y: gestureState.dy });
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (zoomScale <= 1 && gestureState.dy > SWIPE_CLOSE_DISTANCE) {
            closeImageViewer();
            return;
          }
          if (zoomScale <= 1) setTranslate({ x: 0, y: 0 });
          gestureStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          gestureStartRef.current = null;
          if (zoomScale <= 1) setTranslate({ x: 0, y: 0 });
        },
      }),
    [isImageViewerOpen, translate, zoomScale],
  );

  function openImageViewer() {
    if (!previewUri || media?.mediaType !== 'IMAGE') return;
    setIsImageViewerOpen(true);
  }

  function closeImageViewer() {
    setIsImageViewerOpen(false);
    resetImageZoom();
  }

  function resetImageZoom() {
    gestureStartRef.current = null;
    setZoomScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  function handleImageTap() {
    const now = Date.now();
    if (now - lastTapRef.current <= DOUBLE_TAP_MS) {
      setZoomScale((current) => {
        const next = current > 1 ? 1 : DOUBLE_TAP_SCALE;
        if (next === 1) setTranslate({ x: 0, y: 0 });
        return next;
      });
    }
    lastTapRef.current = now;
  }

  async function openDownload() {
    if (!token || !media || isOpening) return;
    setIsOpening(true);
    setOpenError(null);
    try {
      await mediaDownloadRequest(token, media.id);
      const localUri = await downloadAuthenticatedMediaFile(
        token,
        media,
        'attachment',
      );
      await Linking.openURL(localUri);
    } catch (error) {
      const message = "We couldn't open this file. Please try again.";
      setOpenError(message);
      showToast({ message, tone: 'error' });
      if (__DEV__) {
        console.warn('[TradieOS media open failed]', {
          code:
            error instanceof ApiRequestError
              ? error.code
              : 'MEDIA_DOWNLOAD_FAILED',
          mediaId: media.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setIsOpening(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Loading secure preview...</Text>
      </View>
    );
  }

  if (!media) {
    return (
      <View style={styles.loadingPage}>
        <Text style={styles.title}>File not found</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.preview}>
        {media.mediaType === 'IMAGE' ? (
          <View style={styles.imageFrame}>
            {isPreviewLoading ? (
              <View style={styles.previewSkeleton}>
                <ActivityIndicator color={colours.primary} />
                <Text style={styles.muted}>Loading secure image...</Text>
              </View>
            ) : previewUri ? (
              <Pressable
                accessibilityHint="Opens the full-screen photo viewer with zoom controls."
                accessibilityLabel={`Open full-screen preview of ${mediaDisplayTitle(media)}`}
                accessibilityRole="imagebutton"
                onPress={openImageViewer}
                style={styles.previewImageButton}
              >
                <Image
                  accessibilityIgnoresInvertColors
                  accessibilityLabel={`Preview of ${mediaDisplayTitle(media)}`}
                  onError={() => {
                    setPreviewUri(null);
                    setPreviewError("We couldn't load this photo preview.");
                  }}
                  resizeMode="contain"
                  source={{ uri: previewUri }}
                  style={styles.previewImage}
                />
                <View pointerEvents="none" style={styles.tapHint}>
                  <Text style={styles.tapHintText}>Tap to zoom</Text>
                </View>
              </Pressable>
            ) : (
              <View style={styles.previewFallback}>
                <Text style={styles.previewIcon}>Image</Text>
                <Text style={styles.muted}>
                  {previewError ??
                    'Preview unavailable. You can still open the file securely.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isPreviewLoading}
                  onPress={() => void loadPreview(media)}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.documentPreview}>
            <Text style={styles.documentIcon}>
              {media.mediaType === 'PDF' ? 'PDF' : 'DOC'}
            </Text>
          </View>
        )}
        <Text numberOfLines={2} style={styles.previewTitle}>
          {mediaDisplayTitle(media)}
        </Text>
        <Text style={styles.muted}>Secured by your TradieOS login.</Text>
      </View>

      <View style={styles.card}>
        {media.archivedAt ? (
          <Info
            label="Status"
            value={`Archived ${formatBusinessDateTime(media.archivedAt, timezone)}`}
          />
        ) : null}
        <Info label="Category" value={mediaCategoryLabel(media.category)} />
        <Info label="Type" value={mediaTypeLabel(media.mediaType)} />
        <Info
          label="Size"
          value={`${Math.ceil(media.fileSizeBytes / 1024)} KB`}
        />
        <Info
          label="Uploaded"
          value={formatBusinessDateTime(media.createdAt, timezone)}
        />
        <Info
          label="Uploaded by"
          value={
            media.uploadedBy
              ? `${media.uploadedBy.firstName} ${media.uploadedBy.lastName}`
              : 'Unknown'
          }
        />
        <Info label="Caption" value={media.caption ?? 'No caption'} />
        <Info label="Notes" value={media.notes ?? 'No notes'} />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={isOpening}
        onPress={openDownload}
        style={[styles.primaryButton, isOpening && styles.disabledButton]}
      >
        {isOpening ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.primaryText}>
          {isOpening ? 'Opening file...' : 'Open file'}
        </Text>
      </Pressable>

      {openError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{openError}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isOpening}
            onPress={openDownload}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {media.mediaType === 'IMAGE' && previewUri ? (
        <Modal
          animationType="fade"
          onRequestClose={closeImageViewer}
          visible={isImageViewerOpen}
        >
          <View style={styles.fullscreenViewer}>
            <View
              style={[styles.fullscreenHeader, { paddingTop: insets.top + 18 }]}
            >
              <Pressable
                accessibilityLabel="Close full-screen photo viewer"
                accessibilityRole="button"
                onPress={closeImageViewer}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityHint="Double tap to zoom. Swipe down to close when not zoomed."
              accessibilityLabel={`Full-screen photo of ${mediaDisplayTitle(media)}`}
              accessibilityRole="imagebutton"
              onPress={handleImageTap}
              style={styles.fullscreenCanvas}
              {...imageViewerPanResponder.panHandlers}
            >
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={{ uri: previewUri }}
                style={[
                  styles.fullscreenImage,
                  {
                    transform: [
                      { translateX: translate.x },
                      { translateY: translate.y },
                      { scale: zoomScale },
                    ],
                  },
                ]}
              />
            </Pressable>
            <Text style={styles.fullscreenHelp}>
              Pinch or double tap to zoom. Swipe down to close.
            </Text>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

function getTouchDistance(
  touches: ReadonlyArray<{ pageX: number; pageY: number }>,
) {
  if (touches.length < 2) return 0;
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return 0;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 12,
    padding: 16,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: 999,
    borderWidth: 1,
    elevation: 6,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  closeButtonText: { color: '#FFFFFF', fontWeight: '900', lineHeight: 18 },
  container: { gap: 16, padding: 20, paddingBottom: 40 },
  disabledButton: { opacity: 0.72 },
  documentIcon: { color: colours.primary, fontSize: 26, fontWeight: '900' },
  documentPreview: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 22,
    height: 180,
    justifyContent: 'center',
    width: '100%',
  },
  errorCard: {
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  errorText: { color: '#BE123C', fontWeight: '800', textAlign: 'center' },
  fullscreenCanvas: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  fullscreenHeader: {
    alignItems: 'flex-end',
    left: 0,
    padding: 18,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  fullscreenHelp: {
    bottom: 24,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '800',
    left: 20,
    position: 'absolute',
    right: 20,
    textAlign: 'center',
  },
  fullscreenImage: { height: '100%', width: '100%' },
  fullscreenViewer: {
    backgroundColor: '#020617',
    flex: 1,
  },
  imageFrame: {
    backgroundColor: colours.background,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 280,
    overflow: 'hidden',
    width: '100%',
  },
  previewImageButton: {
    flex: 1,
    minHeight: 220,
    position: 'relative',
  },
  infoLabel: { color: colours.muted, fontWeight: '700' },
  infoRow: { gap: 4 },
  infoValue: { color: colours.ink, fontWeight: '800' },
  loadingPage: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    justifyContent: 'center',
  },
  muted: { color: colours.muted, lineHeight: 20, textAlign: 'center' },
  preview: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 28,
    gap: 10,
    padding: 24,
    position: 'relative',
  },
  previewFallback: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    padding: 18,
  },
  previewIcon: { color: colours.primary, fontSize: 20, fontWeight: '900' },
  previewImage: { height: '100%', width: '100%' },
  previewSkeleton: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
  },
  previewTitle: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 18,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 54,
    padding: 16,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '900', textAlign: 'center' },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#FFE4E6',
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: '#BE123C', fontWeight: '900' },
  tapHint: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.64)',
    borderRadius: 999,
    bottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: 'absolute',
  },
  tapHintText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  title: { color: colours.ink, fontSize: 26, fontWeight: '900' },
});
