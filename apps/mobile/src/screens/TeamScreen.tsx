import type { BusinessRole, TeamMember } from '@tradieos/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  deleteMemberRequest,
  inviteMemberRequest,
  membersRequest,
  updateMemberRoleRequest,
  updateMemberStatusRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colours } from '../theme';

const roles: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

const roleColours: Record<string, { background: string; text: string }> = {
  OWNER: { background: '#DCFCE7', text: '#166534' },
  ADMIN: { background: '#DBEAFE', text: '#1D4ED8' },
  OFFICE_MANAGER: { background: '#EDE9FE', text: '#6D28D9' },
  SCHEDULER: { background: '#FEF3C7', text: '#92400E' },
  TECHNICIAN: { background: '#CCFBF1', text: '#0F766E' },
  ACCOUNTANT: { background: '#FCE7F3', text: '#BE185D' },
  SALES: { background: '#FFEDD5', text: '#C2410C' },
  READ_ONLY: { background: '#F1F5F9', text: '#475569' },
  STAFF: { background: '#F1F5F9', text: '#475569' },
};

function roleLabel(role: string) {
  return role.replaceAll('_', ' ');
}

function formatDate(date: string | null) {
  if (!date) {
    return 'Never';
  }

  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

export function TeamScreen() {
  const { token, user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<BusinessRole | 'ALL'>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState<BusinessRole>('TECHNICIAN');

  const canManageTeam = user?.role === 'OWNER' || user?.role === 'ADMIN';

  async function loadMembers() {
    setIsLoading(true);
    setError(null);

    try {
      if (!token) {
        throw new Error('You are not logged in');
      }

      setMembers(await membersRequest(token));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load team members',
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, [token]);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return members.filter((member) => {
      const matchesRole =
        roleFilter === 'ALL' ? true : member.role === roleFilter;
      const matchesSearch = query
        ? `${member.name} ${member.email} ${member.role} ${member.status}`
            .toLowerCase()
            .includes(query)
        : true;

      return matchesRole && matchesSearch;
    });
  }, [members, roleFilter, search]);

  async function submitInvite() {
    if (!token) {
      return;
    }

    setIsInviting(true);
    setError(null);
    setInviteUrl(null);

    try {
      const response = await inviteMemberRequest(token, {
        email: inviteEmail,
        firstName: inviteFirstName || undefined,
        lastName: inviteLastName || undefined,
        role: inviteRole,
      });
      setInviteUrl(response.inviteUrl);
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
      setInviteRole('TECHNICIAN');
      await loadMembers();
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : 'Unable to invite team member',
      );
    } finally {
      setIsInviting(false);
    }
  }

  async function updateRole(member: TeamMember) {
    if (!token) {
      return;
    }

    const currentIndex = roles.indexOf(member.role);
    const nextRole = roles[(currentIndex + 1) % roles.length] ?? 'TECHNICIAN';

    try {
      const updated = await updateMemberRoleRequest(token, member.id, nextRole);
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Unable to change role',
      );
    }
  }

  async function updateStatus(member: TeamMember, status: 'ACTIVE' | 'SUSPENDED') {
    if (!token) {
      return;
    }

    try {
      const updated = await updateMemberStatusRequest(token, member.id, status);
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Unable to update member status',
      );
    }
  }

  async function deleteMember(member: TeamMember) {
    if (!token) {
      return;
    }

    try {
      await deleteMemberRequest(token, member.id);
      setMembers((current) => current.filter((item) => item.id !== member.id));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to remove team member',
      );
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>BUSINESS WORKSPACE</Text>
        <Text style={styles.title}>Team</Text>
        <Text style={styles.subtitle}>
          Invite staff, assign roles, and keep every workspace action scoped to{' '}
          {user?.business.name ?? 'this business'}.
        </Text>

        <TextInput
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search by name, email, role or status"
          placeholderTextColor={colours.muted}
          style={styles.search}
          value={search}
        />

        <ScrollView
          contentContainerStyle={styles.filterRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {(['ALL', ...roles] as Array<BusinessRole | 'ALL'>).map((role) => (
            <Pressable
              accessibilityRole="button"
              key={role}
              onPress={() => setRoleFilter(role)}
              style={[
                styles.filterChip,
                roleFilter === role && styles.filterChipActive,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  roleFilter === role && styles.filterTextActive,
                ]}
              >
                {role === 'ALL' ? 'All' : roleLabel(role)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {canManageTeam ? (
          <View style={styles.inviteCard}>
            <Text style={styles.sectionTitle}>Invite team member</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={setInviteEmail}
              placeholder="Email"
              placeholderTextColor={colours.muted}
              style={styles.input}
              value={inviteEmail}
            />
            <View style={styles.inputRow}>
              <TextInput
                onChangeText={setInviteFirstName}
                placeholder="First name"
                placeholderTextColor={colours.muted}
                style={[styles.input, styles.inputHalf]}
                value={inviteFirstName}
              />
              <TextInput
                onChangeText={setInviteLastName}
                placeholder="Last name"
                placeholderTextColor={colours.muted}
                style={[styles.input, styles.inputHalf]}
                value={inviteLastName}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {roles
                .filter((role) => user?.role === 'OWNER' || role !== 'OWNER')
                .map((role) => (
                  <Pressable
                    accessibilityRole="button"
                    key={role}
                    onPress={() => setInviteRole(role)}
                    style={[
                      styles.rolePicker,
                      inviteRole === role && styles.rolePickerActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rolePickerText,
                        inviteRole === role && styles.rolePickerTextActive,
                      ]}
                    >
                      {roleLabel(role)}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              disabled={isInviting}
              onPress={() => void submitInvite()}
              style={({ pressed }) => [
                styles.inviteButton,
                (pressed || isInviting) && styles.pressed,
              ]}
            >
              <Text style={styles.inviteButtonText}>
                {isInviting ? 'Creating invite...' : 'Create invite'}
              </Text>
            </Pressable>
            {inviteUrl ? (
              <View style={styles.inviteUrlBox}>
                <Text style={styles.inviteUrlLabel}>Invite URL</Text>
                <Text selectable style={styles.inviteUrl}>
                  {inviteUrl}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.stateText}>Loading your team...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Team API unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadMembers()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!isLoading && !filteredMembers.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No team members found</Text>
            <Text style={styles.emptyText}>
              Invite your first team member or adjust your search/filter.
            </Text>
          </View>
        ) : null}

        {filteredMembers.map((member) => {
          const badge = roleColours[member.role] ?? {
            background: '#F1F5F9',
            text: '#475569',
          };
          const canEditMember =
            canManageTeam &&
            member.userId !== user?.id &&
            !(user?.role === 'ADMIN' && member.role === 'OWNER');

          return (
            <View key={member.id} style={styles.memberCard}>
              <View style={styles.memberHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {member.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.name}</Text>
                  <Text style={styles.memberEmail}>{member.email}</Text>
                </View>
              </View>

              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.roleBadge,
                    { backgroundColor: badge.background },
                  ]}
                >
                  <Text style={[styles.roleBadgeText, { color: badge.text }]}>
                    {roleLabel(member.role)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    member.status === 'ACTIVE'
                      ? styles.statusActive
                      : member.status === 'SUSPENDED'
                        ? styles.statusSuspended
                        : styles.statusInvited,
                  ]}
                >
                  <Text style={styles.statusText}>
                    {roleLabel(member.status)}
                  </Text>
                </View>
              </View>

              <Text style={styles.meta}>
                Last login: {formatDate(member.lastLoginAt)}
              </Text>
              <Text style={styles.meta}>
                Joined: {formatDate(member.joinedAt)}
              </Text>
              {member.inviteUrl ? (
                <Text selectable style={styles.memberInviteUrl}>
                  {member.inviteUrl}
                </Text>
              ) : null}

              {canEditMember ? (
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void updateRole(member)}
                    style={styles.secondaryAction}
                  >
                    <Text style={styles.secondaryActionText}>Change role</Text>
                  </Pressable>
                  {member.status === 'SUSPENDED' ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void updateStatus(member, 'ACTIVE')}
                      style={styles.secondaryAction}
                    >
                      <Text style={styles.secondaryActionText}>
                        Reactivate
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void updateStatus(member, 'SUSPENDED')}
                      style={styles.secondaryAction}
                    >
                      <Text style={styles.secondaryActionText}>Suspend</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void deleteMember(member)}
                    style={styles.dangerAction}
                  >
                    <Text style={styles.dangerActionText}>Delete</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { padding: 24, paddingBottom: 40 },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: { color: colours.ink, fontSize: 34, fontWeight: '800', marginTop: 4 },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  search: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    marginTop: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  filterRow: { gap: 8, paddingVertical: 14 },
  filterChip: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterChipActive: { backgroundColor: colours.primary },
  filterText: { color: colours.muted, fontWeight: '700' },
  filterTextActive: { color: '#FFFFFF' },
  inviteCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginTop: 4,
    padding: 18,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  input: {
    backgroundColor: '#F8FAF8',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputHalf: { flex: 1 },
  rolePicker: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rolePickerActive: { backgroundColor: '#E8F3EC', borderColor: colours.primary },
  rolePickerText: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  rolePickerTextActive: { color: colours.primary },
  inviteButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  inviteButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  inviteUrlBox: {
    backgroundColor: '#F8FAF8',
    borderRadius: 14,
    padding: 12,
  },
  inviteUrlLabel: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  inviteUrl: { color: colours.primary, lineHeight: 20, marginTop: 4 },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 14,
    padding: 18,
  },
  stateText: { color: colours.muted },
  errorCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
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
  emptyCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  emptyTitle: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  emptyText: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  memberCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  memberHeader: { flexDirection: 'row', gap: 12 },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#E8F3EC',
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: { color: colours.primary, fontSize: 20, fontWeight: '800' },
  memberInfo: { flex: 1 },
  memberName: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  memberEmail: { color: colours.muted, marginTop: 3 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  roleBadgeText: { fontSize: 12, fontWeight: '800' },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusActive: { backgroundColor: '#DCFCE7' },
  statusSuspended: { backgroundColor: '#FFE4E6' },
  statusInvited: { backgroundColor: '#FEF3C7' },
  statusText: { color: colours.ink, fontSize: 12, fontWeight: '800' },
  meta: { color: colours.muted, marginTop: 8 },
  memberInviteUrl: {
    backgroundColor: '#F8FAF8',
    borderRadius: 12,
    color: colours.primary,
    lineHeight: 20,
    marginTop: 10,
    padding: 10,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  secondaryAction: {
    backgroundColor: '#E8F3EC',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryActionText: { color: colours.primary, fontWeight: '800' },
  dangerAction: {
    backgroundColor: '#FFF1F2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  dangerActionText: { color: '#9F1239', fontWeight: '800' },
});
