import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuditLogEntry, TeamMemberDetailResponse } from '@tradieos/shared';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiRequestError, memberDetailRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TeamMemberProfile'>;

function roleLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function formatDate(date: string | null) {
  if (!date) return 'Not recorded';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

function initials(detail: TeamMemberDetailResponse) {
  const first =
    detail.member.firstName?.charAt(0) ?? detail.member.name.charAt(0);
  const last = detail.member.lastName?.charAt(0) ?? '';
  return `${first}${last}`.toUpperCase();
}

function actionLabel(entry: AuditLogEntry) {
  return entry.action.replaceAll('_', ' ').toLowerCase();
}

function errorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Unable to load profile.';
}

export function TeamMemberProfileScreen({ route }: Props) {
  const { token, user } = useAuth();
  const [detail, setDetail] = useState<TeamMemberDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadProfile() {
    if (!token) return;
    setIsLoading(true);
    setError(null);

    try {
      setDetail(await memberDetailRequest(token, route.params.memberId));
    } catch (profileError) {
      setError(errorMessage(profileError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, [route.params.memberId, token]);

  const canManage =
    user?.role === 'OWNER' ||
    (user?.role === 'ADMIN' && detail?.member.role !== 'OWNER');

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.stateText}>Loading team profile...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Profile unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadProfile()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {detail ? (
          <>
            <View style={styles.headerCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(detail)}</Text>
              </View>
              <Text style={styles.name}>{detail.member.name}</Text>
              <Text style={styles.email}>{detail.member.email}</Text>
              <View style={styles.badgeRow}>
                <Text style={styles.badge}>
                  {roleLabel(detail.member.role)}
                </Text>
                <Text style={styles.badge}>
                  {roleLabel(detail.member.status)}
                </Text>
              </View>
              <Text style={styles.business}>{detail.businessName}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Profile details</Text>
              <Info label="Joined" value={formatDate(detail.member.joinedAt)} />
              <Info
                label="Last login"
                value={formatDate(detail.member.lastLoginAt)}
              />
              <Info
                label="Invited"
                value={formatDate(detail.member.invitedAt)}
              />
              <Info
                label="Invited by"
                value={detail.member.invitedBy ?? 'Not recorded'}
              />
              <Info
                label="Assigned jobs"
                value={`${detail.assignedJobsCount} shown as a placeholder count`}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Available actions</Text>
              <Text style={styles.bodyText}>
                {canManage
                  ? 'Use the Team screen action menu to change role, suspend/reactivate, delete or cancel invites.'
                  : 'You can view this member, but your role cannot manage their access.'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Recent activity</Text>
              {detail.activity.length ? (
                detail.activity.map((entry) => (
                  <View key={entry.id} style={styles.activityItem}>
                    <Text style={styles.activityTitle}>
                      {actionLabel(entry)}
                    </Text>
                    <Text style={styles.activityDate}>
                      {formatDate(entry.createdAt)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.bodyText}>
                  No recent activity recorded.
                </Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
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
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { padding: 24, paddingBottom: 40 },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  stateText: { color: colours.muted },
  errorCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  errorTitle: { color: '#9F1239', fontSize: 16, fontWeight: '800' },
  errorBody: { color: '#9F1239', lineHeight: 20, marginTop: 8 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#9F1239',
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontWeight: '800' },
  headerCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  avatarText: { color: colours.primary, fontSize: 28, fontWeight: '900' },
  name: { color: colours.ink, fontSize: 26, fontWeight: '900', marginTop: 14 },
  email: { color: colours.muted, marginTop: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  badge: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    color: colours.primary,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  business: { color: colours.muted, fontWeight: '700', marginTop: 14 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  bodyText: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  infoRow: {
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  infoLabel: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  infoValue: { color: colours.ink, fontSize: 16, marginTop: 4 },
  activityItem: {
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  activityTitle: {
    color: colours.ink,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  activityDate: { color: colours.muted, marginTop: 3 },
});
