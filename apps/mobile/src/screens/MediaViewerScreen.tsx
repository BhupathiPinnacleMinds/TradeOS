import type { MediaAsset } from '@tradieos/shared';
import {
  formatBusinessDateTime,
  mediaCategoryLabel,
  mediaTypeLabel,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
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

declare const __DEV__: boolean;

type Props = NativeStackScreenProps<RootStackParamList, 'MediaViewer'>;

export function MediaViewerScreen({ navigation, route }: Props) {
  const { mediaId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const timezone = normaliseBusinessTimezone(user?.business.timezone);
  const [media, setMedia] = useState<MediaAsset | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  async function loadMedia() {
    if (!token) return;
    setIsLoading(true);
    setPreviewUri(null);
    setOpenError(null);
    try {
      const detail = await mediaDetailRequest(token, mediaId);
      setMedia(detail.media);
      navigation.setOptions({ title: detail.media.originalFileName });

      if (detail.media.mediaType === 'IMAGE') {
        setIsPreviewLoading(true);
        try {
          await mediaPreviewRequest(token, detail.media.id);
          setPreviewUri(
            await downloadAuthenticatedMediaFile(token, detail.media, 'inline'),
          );
        } catch (error) {
          if (__DEV__) {
            console.warn('[TradieOS media preview failed]', {
              code: 'MEDIA_PREVIEW_FAILED',
              mediaId: detail.media.id,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          setIsPreviewLoading(false);
        }
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
              <Image
                accessibilityLabel={`Preview of ${media.originalFileName}`}
                resizeMode="contain"
                source={{ uri: previewUri }}
                style={styles.previewImage}
              />
            ) : (
              <View style={styles.previewFallback}>
                <Text style={styles.previewIcon}>Image</Text>
                <Text style={styles.muted}>
                  Preview unavailable. You can still open the file securely.
                </Text>
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
          {media.originalFileName}
        </Text>
        <Text style={styles.muted}>Secured by your TradieOS login.</Text>
      </View>

      <View style={styles.card}>
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
    </ScrollView>
  );
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
  imageFrame: {
    backgroundColor: colours.background,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 280,
    overflow: 'hidden',
    width: '100%',
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
  title: { color: colours.ink, fontSize: 26, fontWeight: '900' },
});
