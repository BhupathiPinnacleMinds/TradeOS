import type { MediaCategory } from '@tradieos/shared';
import { mediaCategoryLabel } from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createMediaUploadTargetRequest,
  uploadLocalMediaRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MediaEvidence'>;

const demoPhotoBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const demoPdfBase64 =
  'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1szIDAgUl0+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMTIwIDgwXS9Db250ZW50cyA0IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMTIgVGYgMTAgNDAgVGQgKFRyYWRpZU9TIGRlbW8gbWVkaWEpIFRqIEVUCmVuZHN0cmVhbSBlbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+PgolJUVPRg==';

const categories: Array<{ label: string; value: MediaCategory }> = [
  { label: 'Before', value: 'BEFORE_PHOTO' },
  { label: 'Progress', value: 'PROGRESS_PHOTO' },
  { label: 'After', value: 'AFTER_PHOTO' },
  { label: 'Damage', value: 'DAMAGE_EVIDENCE' },
  { label: 'Certificate', value: 'COMPLIANCE_CERTIFICATE' },
  { label: 'Receipt', value: 'RECEIPT' },
  { label: 'Other', value: 'GENERAL_DOCUMENT' },
];

function isDocumentCategory(category: MediaCategory) {
  return category === 'GENERAL_DOCUMENT' || category === 'RECEIPT';
}

export function MediaEvidenceScreen({ navigation, route }: Props) {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [category, setCategory] = useState<MediaCategory>('BEFORE_PHOTO');
  const [caption, setCaption] = useState('');
  const [notes, setNotes] = useState('');
  const [isCustomerVisible, setIsCustomerVisible] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const canSetCustomerVisible = ['OWNER', 'ADMIN', 'OFFICE_MANAGER'].includes(
    user?.role ?? '',
  );
  const hasMediaContext = Boolean(
    route.params?.appointmentId ||
    route.params?.jobId ||
    route.params?.customerId,
  );

  async function uploadDemoEvidence() {
    if (!token || progress !== null) return;
    if (!hasMediaContext) {
      showToast({
        message:
          'Open evidence from My Day, an appointment, job or customer first.',
        tone: 'error',
      });
      return;
    }
    setProgress(25);
    try {
      const isDocument = isDocumentCategory(category);
      const target = await createMediaUploadTargetRequest(token, {
        appointmentId: route.params?.appointmentId,
        caption,
        category,
        customerId: route.params?.customerId,
        fileSizeBytes: isDocument ? 301 : 68,
        height: isDocument ? undefined : 1,
        isCustomerVisible,
        jobId: route.params?.jobId,
        mediaType: isDocument ? 'PDF' : 'IMAGE',
        mimeType: isDocument ? 'application/pdf' : 'image/png',
        notes,
        originalFileName: isDocument
          ? 'tradieos-demo-document.pdf'
          : 'tradieos-demo-photo.png',
        width: isDocument ? undefined : 1,
      });
      setProgress(70);
      await uploadLocalMediaRequest(token, target.media.id, {
        contentBase64: isDocument ? demoPdfBase64 : demoPhotoBase64,
      });
      setProgress(100);
      showToast({ message: 'Evidence uploaded.', tone: 'success' });
      navigation.goBack();
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't upload this evidence.",
        tone: 'error',
      });
    } finally {
      setProgress(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Photos & documents</Text>
      <Text style={styles.title}>Add job evidence</Text>
      <Text style={styles.subtitle}>
        Use this foundation flow to capture before/progress/after photos,
        compliance documents and receipts. Tori will only draft summaries from
        these files after you confirm.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {categories.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setCategory(item.value)}
              style={[
                styles.chip,
                category === item.value ? styles.chipActive : null,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  category === item.value ? styles.chipTextActive : null,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Caption</Text>
        <TextInput
          onChangeText={setCaption}
          placeholder="e.g. Before photo of switchboard"
          placeholderTextColor={colours.muted}
          style={styles.input}
          value={caption}
        />
        <Text style={styles.label}>Notes</Text>
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
            <View>
              <Text style={styles.label}>Visible to customer</Text>
              <Text style={styles.muted}>Default is private to your team.</Text>
            </View>
            <Switch
              onValueChange={setIsCustomerVisible}
              value={isCustomerVisible}
            />
          </View>
        ) : null}
      </View>

      {progress !== null ? (
        <View style={styles.progress}>
          <ActivityIndicator color={colours.primary} />
          <Text style={styles.muted}>Uploading... {progress}%</Text>
        </View>
      ) : null}

      {!hasMediaContext ? (
        <Text style={styles.muted}>
          No appointment, job or customer is selected yet.
        </Text>
      ) : null}

      <Pressable
        disabled={progress !== null || !hasMediaContext}
        onPress={uploadDemoEvidence}
        style={[
          styles.primaryButton,
          progress !== null || !hasMediaContext ? styles.disabled : null,
        ]}
      >
        <Text style={styles.primaryText}>
          Upload demo {mediaCategoryLabel(category).toLowerCase()}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 12,
    padding: 16,
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
  disabled: { opacity: 0.6 },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colours.background,
    borderRadius: 14,
    color: colours.ink,
    padding: 12,
  },
  label: { color: colours.ink, fontWeight: '800' },
  muted: { color: colours.muted },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 18,
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
  subtitle: { color: colours.muted, fontSize: 15, lineHeight: 22 },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  title: { color: colours.ink, fontSize: 28, fontWeight: '900' },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
