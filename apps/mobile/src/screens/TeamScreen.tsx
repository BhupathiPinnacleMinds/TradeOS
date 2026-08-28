import type { BusinessRole, MemberStatus, TeamMember } from '@tradieos/shared';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  ApiRequestError,
  cancelInvitationRequest,
  deleteMemberRequest,
  inviteMemberRequest,
  membersRequest,
  resendInvitationRequest,
  updateMemberRoleRequest,
  updateMemberStatusRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import { canManageTeam } from '../permissions/roleVisibility';
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

const statusFilters: Array<MemberStatus | 'ALL'> = [
  'ALL',
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
];

const roleDescriptions: Record<BusinessRole, string> = {
  OWNER: 'Full business access, including owners, settings and future billing.',
  ADMIN: 'Broad office access and team management, except owner controls.',
  OFFICE_MANAGER: 'Customers, jobs, quotes, invoices, calendar and messages.',
  SCHEDULER: 'Customers, jobs, calendar and Tori scheduling support.',
  TECHNICIAN:
    "Today's jobs, assigned jobs, customer details and job completion.",
  ACCOUNTANT: 'Invoices, payments, GST, reports and exports.',
  SALES: 'Customers, quotes, follow-ups and sales support from Tori.',
  READ_ONLY: 'View-only access without editing permissions.',
  STAFF: 'Legacy role. Choose a more specific role for new members.',
};

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

const defaultRoleColour = { background: '#F1F5F9', text: '#475569' };

type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
type ActionType =
  | 'CREATE_INVITE'
  | 'RESEND_INVITE'
  | 'COPY_INVITE'
  | 'CANCEL_INVITE'
  | 'VIEW_PROFILE'
  | 'CHANGE_ROLE'
  | 'SUSPEND'
  | 'REACTIVATE'
  | 'DELETE_MEMBER';
type MenuAnchor = { height: number; width: number; x: number; y: number };
type DevelopmentInvite = { email: string; memberId: string; url: string };
type PendingAction =
  | { type: 'invite-owner' }
  | { type: 'suspend'; member: TeamMember }
  | { type: 'reactivate'; member: TeamMember }
  | { type: 'delete'; member: TeamMember }
  | { type: 'cancel-invite'; member: TeamMember }
  | null;

function roleLabel(role: string) {
  return role.replaceAll('_', ' ');
}

function formatDate(date: string | null) {
  if (!date) return 'Not recorded';

  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

function initials(member: TeamMember) {
  const first = member.firstName?.charAt(0) ?? member.name.charAt(0);
  const last = member.lastName?.charAt(0) ?? '';
  return `${first}${last}`.toUpperCase();
}

function errorCopy(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return {
      title: 'Something went wrong',
      message: error instanceof Error ? error.message : 'Please try again.',
      tone: 'error' as const,
      code: 'UNKNOWN',
      details: {},
    };
  }

  const map: Record<string, string> = {
    VALIDATION_ERROR: 'Please check the highlighted details and try again.',
    SESSION_EXPIRED: 'Your session has expired. Please log in again.',
    INSUFFICIENT_PERMISSION:
      'You do not have permission to perform this team action.',
    INVITE_ALREADY_PENDING: 'An invitation is already pending for this email.',
    MEMBER_ALREADY_ACTIVE:
      'This person is already an active member of this workspace.',
    MEMBER_SUSPENDED: 'This member is suspended. Reactivate them instead.',
    LAST_OWNER_PROTECTED: 'The last active owner is protected.',
    CANNOT_CHANGE_OWN_ROLE: 'You cannot change your own role.',
    TOO_MANY_REQUESTS: 'Too many attempts. Please wait a moment and try again.',
    INVITE_CANCELLED: 'This invitation has already been cancelled.',
    INVITE_EXPIRED: 'This invitation has expired.',
    INVITE_ALREADY_ACCEPTED: 'This invitation has already been accepted.',
    EMAIL_DELIVERY_FAILED:
      "We couldn't send the invitation email. Please try again.",
    NETWORK_ERROR:
      "We couldn't connect to the Team service. Check your connection and try again.",
    SERVICE_UNAVAILABLE:
      "We couldn't connect to the Team service. Check your connection and try again.",
  };

  return {
    title:
      error.code === 'NETWORK_ERROR' || (error.status ?? 0) >= 500
        ? 'Team service unavailable'
        : 'Team action needs attention',
    message: map[error.code] ?? error.message,
    tone:
      error.code.startsWith('MEMBER_') || error.code.startsWith('INVITE_')
        ? ('warning' as const)
        : ('error' as const),
    code: error.code,
    details: error.details,
  };
}

export function TeamScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const navigation = useNavigation<RootNavigation>();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const menuButtonRefs = useRef<Record<string, View | null>>({});
  const hasLoadedMembersRef = useRef(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<BusinessRole | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<MemberStatus | 'ALL'>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [isInviteModalVisible, setIsInviteModalVisible] = useState(false);
  const [developmentInvite, setDevelopmentInvite] =
    useState<DevelopmentInvite | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState<BusinessRole>('TECHNICIAN');
  const [highlightedMemberId, setHighlightedMemberId] = useState<string | null>(
    null,
  );
  const [menuMember, setMenuMember] = useState<TeamMember | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [roleMember, setRoleMember] = useState<TeamMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<BusinessRole>('TECHNICIAN');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [activeAction, setActiveAction] = useState<{
    actionType: ActionType;
    memberId: string;
  } | null>(null);

  const canManageTeamMembers = canManageTeam(user?.role);
  const isDevelopment = process.env.NODE_ENV !== 'production';

  async function refreshMembers() {
    if (!token) throw new Error('You are not logged in');
    const nextMembers = (await membersRequest(token)).filter(
      (member) => !member.inviteCancelledAt,
    );
    setMembers(nextMembers);
    setDevelopmentInvite((current) => {
      if (!current) return null;
      const relatedMember = nextMembers.find(
        (member) => member.id === current.memberId,
      );
      if (
        relatedMember?.status === 'INVITED' &&
        !relatedMember.inviteCancelledAt
      ) {
        return current;
      }
      return null;
    });
    return nextMembers;
  }

  async function loadMembers(options: { silent?: boolean } = {}) {
    if (!options.silent) setIsLoading(true);

    try {
      await refreshMembers();
    } catch (loadError) {
      const copy = errorCopy(loadError);
      showToast({ message: copy.message, tone: copy.tone });
    } finally {
      if (!options.silent) setIsLoading(false);
    }
  }

  useEffect(() => {
    hasLoadedMembersRef.current = false;
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (!token) return undefined;

      const shouldRefreshInBackground = hasLoadedMembersRef.current;
      hasLoadedMembersRef.current = true;
      void loadMembers({ silent: shouldRefreshInBackground });

      return undefined;
    }, [token]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await loadMembers({ silent: true });
    } finally {
      setIsRefreshing(false);
    }
  }

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return members.filter((member) => {
      const haystack = [
        member.firstName,
        member.lastName,
        member.name,
        member.email,
        member.role,
        member.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return (
        (roleFilter === 'ALL' || member.role === roleFilter) &&
        (statusFilter === 'ALL' || member.status === statusFilter) &&
        (!query || haystack.includes(query))
      );
    });
  }, [members, roleFilter, search, statusFilter]);

  function validateInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        field: 'email' as const,
        message: 'Enter a valid email address.',
      };
    }
    const existingMember = members.find(
      (member) => member.email.trim().toLowerCase() === email,
    );
    if (existingMember?.status === 'INVITED') {
      return {
        field: 'email' as const,
        memberId: existingMember.id,
        message: 'An invitation is already pending for this email.',
      };
    }
    if (existingMember?.status === 'ACTIVE') {
      return {
        field: 'email' as const,
        memberId: existingMember.id,
        message: 'This person is already part of your team.',
      };
    }
    if (existingMember?.status === 'SUSPENDED') {
      return {
        field: 'email' as const,
        memberId: existingMember.id,
        message:
          'This member is suspended. Reactivate them from the Team list.',
      };
    }
    if (!inviteFirstName.trim()) return { message: 'Enter a first name.' };
    if (!inviteLastName.trim()) return { message: 'Enter a last name.' };
    if (!roles.includes(inviteRole)) return { message: 'Choose a valid role.' };
    if (inviteRole === 'OWNER' && user?.role !== 'OWNER') {
      return { message: 'Only an owner can invite another owner.' };
    }
    return null;
  }

  async function createInvite(confirmedOwnerInvite = false) {
    if (!token || isInviting) return;

    const validationError = validateInvite();
    if (validationError) {
      if (validationError.field === 'email') {
        setInviteEmailError(validationError.message);
      }
      if (validationError.memberId) {
        setHighlightedMemberId(validationError.memberId);
      }
      showToast({ message: validationError.message, tone: 'warning' });
      return;
    }

    if (inviteRole === 'OWNER' && !confirmedOwnerInvite) {
      setPendingAction({ type: 'invite-owner' });
      return;
    }

    setIsInviting(true);
    setActiveAction({ actionType: 'CREATE_INVITE', memberId: 'invite' });
    setDevelopmentInvite(null);

    try {
      const email = inviteEmail.trim().toLowerCase();
      const response = await inviteMemberRequest(token, {
        email,
        firstName: inviteFirstName.trim(),
        lastName: inviteLastName.trim(),
        role: inviteRole,
      });
      if (response.inviteUrl) {
        setDevelopmentInvite({
          email,
          memberId: response.member.id,
          url: response.inviteUrl,
        });
      }
      setInviteEmail('');
      setInviteEmailError(null);
      setInviteFirstName('');
      setInviteLastName('');
      setInviteRole('TECHNICIAN');
      setIsInviteModalVisible(false);
      setHighlightedMemberId(response.member.id);
      await refreshMembers();
      showToast({
        message: `Invitation created for ${email}.`,
        tone: 'success',
      });
    } catch (inviteError) {
      const copy = errorCopy(inviteError);
      const memberId =
        typeof copy.details.memberId === 'string'
          ? copy.details.memberId
          : null;
      setHighlightedMemberId(memberId);
      if (
        copy.code === 'INVITE_ALREADY_PENDING' ||
        copy.code === 'MEMBER_ALREADY_ACTIVE' ||
        copy.code === 'MEMBER_SUSPENDED'
      ) {
        setInviteEmailError(copy.message);
      }
      showToast({ message: copy.message, tone: copy.tone });
    } finally {
      setIsInviting(false);
      setActiveAction(null);
      setPendingAction(null);
    }
  }

  function openRoleModal(member: TeamMember) {
    setMenuMember(null);
    setMenuAnchor(null);
    setSelectedRole(member.role);
    setRoleMember(member);
  }

  async function applyRoleChange() {
    if (!token || !roleMember || activeAction) return;
    setActiveAction({ actionType: 'CHANGE_ROLE', memberId: roleMember.id });
    try {
      const updated = await updateMemberRoleRequest(
        token,
        roleMember.id,
        selectedRole,
      );
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRoleMember(null);
      await refreshMembers();
      showToast({
        message: `${updated.name}'s role was changed to ${roleLabel(updated.role)}.`,
        tone: 'success',
      });
    } catch (error) {
      const copy = errorCopy(error);
      showToast({ message: copy.message, tone: copy.tone });
    } finally {
      setActiveAction(null);
    }
  }

  async function performAction(action: Exclude<PendingAction, null>) {
    if (!token || activeAction) return;
    setMenuMember(null);
    setMenuAnchor(null);
    setActiveAction({
      actionType: actionToActionType(action),
      memberId: action.type === 'invite-owner' ? 'invite' : action.member.id,
    });

    try {
      if (action.type === 'invite-owner') {
        setPendingAction(null);
        await createInvite(true);
        return;
      }

      if (action.type === 'suspend' || action.type === 'reactivate') {
        const nextStatus = action.type === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
        const updated = await updateMemberStatusRequest(
          token,
          action.member.id,
          nextStatus,
        );
        setMembers((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        showToast({
          message:
            nextStatus === 'SUSPENDED'
              ? `${updated.name} can no longer access this workspace.`
              : `${updated.name} can access this workspace again.`,
          tone: 'success',
        });
      }

      if (action.type === 'delete') {
        await deleteMemberRequest(token, action.member.id);
        setMembers((current) =>
          current.filter((item) => item.id !== action.member.id),
        );
        showToast({
          message: `${action.member.name} was removed from the workspace.`,
          tone: 'success',
        });
      }

      if (action.type === 'cancel-invite') {
        const updated = await cancelInvitationRequest(token, action.member.id);
        setMembers((current) =>
          current.filter((item) => item.id !== updated.id),
        );
        setDevelopmentInvite((current) =>
          current?.memberId === action.member.id ? null : current,
        );
        showToast({
          message: `Invitation cancelled for ${updated.email}.`,
          tone: 'success',
        });
      }

      setPendingAction(null);
      setHighlightedMemberId(null);
      await refreshMembers();
    } catch (error) {
      const copy = errorCopy(error);
      showToast({ message: copy.message, tone: copy.tone });
    } finally {
      setActiveAction(null);
    }
  }

  async function resendInvite(member: TeamMember) {
    if (!token || activeAction) return;
    setActiveAction({ actionType: 'RESEND_INVITE', memberId: member.id });
    setMenuMember(null);
    setMenuAnchor(null);
    try {
      const response = await resendInvitationRequest(token, member.id);
      if (response.inviteUrl) {
        setDevelopmentInvite({
          email: response.member.email,
          memberId: response.member.id,
          url: response.inviteUrl,
        });
      }
      setHighlightedMemberId(response.member.id);
      setMembers((current) =>
        current.map((item) =>
          item.id === response.member.id ? response.member : item,
        ),
      );
      await refreshMembers();
      showToast({
        message: `A new invitation link was created for ${response.member.email}.`,
        tone: 'success',
      });
    } catch (error) {
      const copy = errorCopy(error);
      showToast({ message: copy.message, tone: copy.tone });
    } finally {
      setActiveAction(null);
    }
  }

  async function copyInviteLink(member: TeamMember) {
    setMenuMember(null);
    setMenuAnchor(null);
    setActiveAction({ actionType: 'COPY_INVITE', memberId: member.id });
    const link =
      member.inviteUrl ??
      (developmentInvite?.memberId === member.id
        ? developmentInvite.url
        : null);
    if (!link) {
      showToast({
        message: 'Resend the invite to create a fresh copyable link.',
        tone: 'warning',
      });
      setActiveAction(null);
      return;
    }

    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(link);
      showToast({
        message: 'Invite link copied.',
        tone: 'success',
      });
      setActiveAction(null);
      return;
    }

    setDevelopmentInvite({
      email: member.email,
      memberId: member.id,
      url: link,
    });
    showToast({
      message:
        'Copy is unavailable here. Press and hold the invite link to select it.',
      tone: 'warning',
    });
    setActiveAction(null);
  }

  function viewProfile(member: TeamMember) {
    setMenuMember(null);
    setMenuAnchor(null);
    setActiveAction({ actionType: 'VIEW_PROFILE', memberId: member.id });
    navigation.navigate('TeamMemberProfile', { memberId: member.id });
    setActiveAction(null);
  }

  function openActionMenu(member: TeamMember) {
    if (activeAction?.memberId === member.id) return;
    const anchor = menuButtonRefs.current[member.id];
    if (!anchor) {
      setMenuAnchor(null);
      setMenuMember(member);
      return;
    }

    anchor.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ height, width, x, y });
      setMenuMember(member);
    });
  }

  function emptyMessage() {
    if (search.trim()) return 'No team members match your search.';
    if (statusFilter === 'INVITED') return 'No invited members.';
    if (statusFilter === 'SUSPENDED') return 'No suspended members.';
    return 'No team members found.';
  }

  function resetInviteForm() {
    setInviteEmail('');
    setInviteEmailError(null);
    setInviteFirstName('');
    setInviteLastName('');
    setInviteRole('TECHNICIAN');
  }

  function closeInviteModal() {
    resetInviteForm();
    setIsInviteModalVisible(false);
  }

  const confirmCopy = pendingAction ? getConfirmationCopy(pendingAction) : null;
  const confirmBusy =
    Boolean(pendingAction) &&
    activeAction?.memberId ===
      (pendingAction?.type === 'invite-owner'
        ? 'invite'
        : pendingAction?.member.id);
  const loadingText = activeAction
    ? loadingOverlayText(activeAction.actionType)
    : null;
  const visibleDevelopmentInvite =
    isDevelopment &&
    developmentInvite &&
    members.some(
      (member) =>
        member.id === developmentInvite.memberId &&
        member.status === 'INVITED' &&
        !member.inviteCancelledAt,
    )
      ? developmentInvite
      : null;

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        onScrollBeginDrag={() => {
          setMenuMember(null);
          setMenuAnchor(null);
        }}
        refreshControl={
          <RefreshControl
            colors={[colours.primary]}
            onRefresh={() => void handleRefresh()}
            refreshing={isRefreshing}
            tintColor={colours.primary}
          />
        }
        scrollEventThrottle={16}
      >
        <Text style={styles.eyebrow}>BUSINESS WORKSPACE</Text>
        <Text style={styles.title}>Team</Text>
        <Text style={styles.subtitle}>
          Invite staff, assign roles and keep every team action scoped to{' '}
          {user?.business.name ?? 'this business'}.
        </Text>

        {canManageTeamMembers ? (
          <Pressable
            accessibilityLabel="Invite team member"
            accessibilityRole="button"
            onPress={() => setIsInviteModalVisible(true)}
            style={styles.topInviteButton}
          >
            <Text style={styles.topInviteButtonText}>Invite team member</Text>
          </Pressable>
        ) : null}

        <TextInput
          accessibilityLabel="Search team members"
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search name, email, role or status"
          placeholderTextColor={colours.muted}
          style={styles.search}
          value={search}
        />

        <Text style={styles.resultCount}>
          {filteredMembers.length} of {members.length} team members
        </Text>

        <ScrollView
          accessibilityLabel="Status filters"
          contentContainerStyle={styles.filterRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {statusFilters.map((status) => (
            <Pressable
              accessibilityLabel={`Filter by ${status === 'ALL' ? 'all statuses' : status.toLowerCase()}`}
              accessibilityRole="button"
              key={status}
              onPress={() => setStatusFilter(status)}
              style={[
                styles.filterChip,
                statusFilter === status && styles.filterChipActive,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  statusFilter === status && styles.filterTextActive,
                ]}
              >
                {status === 'ALL' ? 'All' : roleLabel(status)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView
          accessibilityLabel="Role filters"
          contentContainerStyle={styles.filterRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {(['ALL', ...roles] as Array<BusinessRole | 'ALL'>).map((role) => (
            <Pressable
              accessibilityLabel={`Filter by ${role === 'ALL' ? 'all roles' : roleLabel(role)}`}
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
                {role === 'ALL' ? 'All roles' : roleLabel(role)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {visibleDevelopmentInvite ? (
          <View style={styles.inviteUrlBox}>
            <Text style={styles.inviteUrlLabel}>
              Latest development invite URL
            </Text>
            <Text selectable style={styles.inviteUrl}>
              {visibleDevelopmentInvite.url}
            </Text>
            <View style={styles.inviteUrlActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void copyInviteLink({
                    id: visibleDevelopmentInvite.memberId,
                    email: visibleDevelopmentInvite.email,
                  } as TeamMember)
                }
                style={styles.smallLinkButton}
              >
                <Text style={styles.smallLinkButtonText}>Copy invite link</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void Share.share({ message: visibleDevelopmentInvite.url })
                }
                style={styles.smallLinkButton}
              >
                <Text style={styles.smallLinkButtonText}>
                  Share invite link
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.stateText}>Loading your team...</Text>
          </View>
        ) : null}

        {!isLoading && !filteredMembers.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{emptyMessage()}</Text>
            <Text style={styles.emptyText}>
              Try a different search or filter.
            </Text>
          </View>
        ) : null}

        {filteredMembers.map((member) => {
          const badge = roleColours[member.role] ?? defaultRoleColour;
          const canEditMember =
            canManageTeamMembers &&
            member.userId !== user?.id &&
            !(user?.role === 'ADMIN' && member.role === 'OWNER');
          const memberAction = activeAction?.memberId === member.id;

          return (
            <View
              key={member.id}
              style={[
                styles.memberCard,
                highlightedMemberId === member.id && styles.highlightedCard,
              ]}
            >
              <View style={styles.memberHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(member)}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.name}</Text>
                  <Text style={styles.memberEmail}>{member.email}</Text>
                </View>
                {canEditMember ? (
                  <Pressable
                    ref={(node) => {
                      menuButtonRefs.current[member.id] = node as View | null;
                    }}
                    accessibilityLabel={`Open actions for ${member.name}`}
                    accessibilityRole="button"
                    disabled={memberAction}
                    onPress={() => openActionMenu(member)}
                    style={[styles.menuButton, memberAction && styles.pressed]}
                  >
                    {memberAction ? (
                      <ActivityIndicator color={colours.primary} size="small" />
                    ) : (
                      <Text style={styles.menuButtonText}>•••</Text>
                    )}
                  </Pressable>
                ) : null}
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
              {member.status === 'INVITED' ? (
                <Text style={styles.meta}>
                  Invited: {formatDate(member.invitedAt)}
                </Text>
              ) : null}
              {memberAction ? (
                <View style={styles.memberProgress}>
                  <ActivityIndicator color={colours.primary} size="small" />
                  <Text style={styles.memberProgressText}>
                    Updating team member...
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <InviteModal
        currentUserRole={user?.role}
        inviteEmail={inviteEmail}
        inviteEmailError={inviteEmailError}
        inviteFirstName={inviteFirstName}
        inviteLastName={inviteLastName}
        inviteRole={inviteRole}
        isBusy={isInviting}
        isVisible={isInviteModalVisible}
        onClose={closeInviteModal}
        onInvite={() => void createInvite()}
        setInviteEmail={(value) => {
          setInviteEmail(value);
          setInviteEmailError(null);
        }}
        setInviteFirstName={setInviteFirstName}
        setInviteLastName={setInviteLastName}
        setInviteRole={setInviteRole}
      />

      <ActionMenu
        anchor={menuAnchor}
        member={menuMember}
        onCancelInvite={(member) =>
          setPendingAction({ type: 'cancel-invite', member })
        }
        onChangeRole={openRoleModal}
        onClose={() => setMenuMember(null)}
        onCopyInvite={(member) => void copyInviteLink(member)}
        onDelete={(member) => setPendingAction({ type: 'delete', member })}
        onReactivate={(member) =>
          setPendingAction({ type: 'reactivate', member })
        }
        onResend={(member) => void resendInvite(member)}
        onSuspend={(member) => setPendingAction({ type: 'suspend', member })}
        onViewProfile={viewProfile}
        windowHeight={windowHeight}
        windowWidth={windowWidth}
      />

      <RoleModal
        currentUserRole={user?.role}
        member={roleMember}
        onApply={() => void applyRoleChange()}
        onClose={() => setRoleMember(null)}
        selectedRole={selectedRole}
        setSelectedRole={setSelectedRole}
        busy={activeAction?.actionType === 'CHANGE_ROLE'}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (!confirmBusy) setPendingAction(null);
        }}
        transparent
        visible={Boolean(pendingAction)}
      >
        <Pressable
          accessibilityLabel="Close confirmation"
          style={styles.modalBackdrop}
          onPress={() => {
            if (!confirmBusy) setPendingAction(null);
          }}
        >
          <Pressable style={styles.confirmCard}>
            <Text style={styles.modalTitle}>{confirmCopy?.title}</Text>
            <Text style={styles.modalBody}>{confirmCopy?.body}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={confirmBusy}
                onPress={() => setPendingAction(null)}
                style={[styles.modalSecondary, confirmBusy && styles.pressed]}
              >
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={confirmBusy}
                onPress={() =>
                  pendingAction ? void performAction(pendingAction) : undefined
                }
                style={[
                  styles.modalPrimary,
                  confirmCopy?.destructive && styles.modalDanger,
                ]}
              >
                {confirmBusy ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : null}
                <Text style={styles.modalPrimaryText}>
                  {confirmBusy && pendingAction
                    ? actionLoadingText(pendingAction)
                    : confirmCopy?.confirm}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <LoadingOverlay text={loadingText} />
    </SafeAreaView>
  );
}

function getConfirmationCopy(action: Exclude<PendingAction, null>) {
  if (action.type === 'invite-owner') {
    return {
      title: 'Invite another owner?',
      body: 'This member will receive full business access, including owner-level team controls. Continue?',
      confirm: 'Invite owner',
      destructive: false,
    };
  }

  if (action.type === 'suspend') {
    return {
      title: 'Suspend member?',
      body: 'Suspending this member will immediately block access to the workspace. Continue?',
      confirm: 'Suspend',
      destructive: true,
    };
  }

  if (action.type === 'reactivate') {
    return {
      title: 'Reactivate member?',
      body: `${action.member.name} will regain access based on their assigned role.`,
      confirm: 'Reactivate',
      destructive: false,
    };
  }

  if (action.type === 'cancel-invite') {
    return {
      title: 'Cancel invitation?',
      body: `Cancel the pending invitation for ${action.member.email}? The current invite link will no longer work.`,
      confirm: 'Cancel invite',
      destructive: true,
    };
  }

  return {
    title: 'Remove member?',
    body: `Remove ${action.member.name} from this business? They will lose access to the workspace. Existing jobs and audit history will remain.`,
    confirm: 'Delete',
    destructive: true,
  };
}

function actionToActionType(action: Exclude<PendingAction, null>): ActionType {
  if (action.type === 'invite-owner') return 'CREATE_INVITE';
  if (action.type === 'cancel-invite') return 'CANCEL_INVITE';
  if (action.type === 'suspend') return 'SUSPEND';
  if (action.type === 'reactivate') return 'REACTIVATE';
  return 'DELETE_MEMBER';
}

function actionLoadingText(action: Exclude<PendingAction, null>) {
  if (action.type === 'invite-owner') return 'Creating...';
  if (action.type === 'cancel-invite') return 'Cancelling...';
  if (action.type === 'suspend') return 'Suspending...';
  if (action.type === 'reactivate') return 'Reactivating...';
  return 'Removing...';
}

function loadingOverlayText(actionType: ActionType) {
  const copy: Record<ActionType, string | null> = {
    CANCEL_INVITE: 'Cancelling invitation...',
    CHANGE_ROLE: 'Updating role...',
    COPY_INVITE: null,
    CREATE_INVITE: 'Creating invitation...',
    DELETE_MEMBER: 'Removing member...',
    REACTIVATE: 'Reactivating member...',
    RESEND_INVITE: 'Resending invitation...',
    SUSPEND: 'Suspending member...',
    VIEW_PROFILE: null,
  };

  return copy[actionType];
}

function LoadingOverlay({ text }: { text: string | null }) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(text)}>
      <View
        accessibilityLabel={text ?? 'Team action in progress'}
        accessibilityState={{ busy: true }}
        style={styles.loadingBackdrop}
      >
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colours.primary} size="large" />
          <Text style={styles.loadingText}>{text}</Text>
        </View>
      </View>
    </Modal>
  );
}

function InviteModal({
  currentUserRole,
  inviteEmail,
  inviteEmailError,
  inviteFirstName,
  inviteLastName,
  inviteRole,
  isBusy,
  isVisible,
  onClose,
  onInvite,
  setInviteEmail,
  setInviteFirstName,
  setInviteLastName,
  setInviteRole,
}: {
  currentUserRole?: BusinessRole;
  inviteEmail: string;
  inviteEmailError: string | null;
  inviteFirstName: string;
  inviteLastName: string;
  inviteRole: BusinessRole;
  isBusy: boolean;
  isVisible: boolean;
  onClose(): void;
  onInvite(): void;
  setInviteEmail(value: string): void;
  setInviteFirstName(value: string): void;
  setInviteLastName(value: string): void;
  setInviteRole(value: BusinessRole): void;
}) {
  const insets = useSafeAreaInsets();

  function closeModal() {
    Keyboard.dismiss();
    onClose();
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!isBusy) closeModal();
      }}
      transparent
      visible={isVisible}
    >
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        style={styles.modalKeyboardAvoider}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView
            contentContainerStyle={[
              styles.inviteModalScrollContent,
              {
                paddingBottom: Math.max(24, insets.bottom + 24),
                paddingTop: Math.max(24, insets.top + 12),
              },
            ]}
            keyboardDismissMode={
              Platform.OS === 'ios' ? 'interactive' : 'on-drag'
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.inviteModalScroll}
          >
            <Pressable
              accessibilityLabel="Close invite modal"
              disabled={isBusy}
              onPress={closeModal}
              style={styles.inviteModalTouchLayer}
            >
              <Pressable
                onPress={(event) => event.stopPropagation()}
                style={styles.inviteModal}
              >
                <Text style={styles.modalTitle}>Invite team member</Text>
                <Text style={styles.modalBody}>
                  Invite someone into this workspace. They will not create a new
                  business.
                </Text>
                <TextInput
                  accessibilityLabel="Invite email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onChangeText={setInviteEmail}
                  placeholder="Email"
                  placeholderTextColor={colours.muted}
                  style={[styles.input, inviteEmailError && styles.inputError]}
                  value={inviteEmail}
                />
                {inviteEmailError ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.fieldError}
                  >
                    {inviteEmailError}
                  </Text>
                ) : null}
                <View style={styles.inputRow}>
                  <TextInput
                    accessibilityLabel="Invite first name"
                    onChangeText={setInviteFirstName}
                    placeholder="First name"
                    placeholderTextColor={colours.muted}
                    style={[styles.input, styles.inputHalf]}
                    value={inviteFirstName}
                  />
                  <TextInput
                    accessibilityLabel="Invite last name"
                    onChangeText={setInviteLastName}
                    placeholder="Last name"
                    placeholderTextColor={colours.muted}
                    style={[styles.input, styles.inputHalf]}
                    value={inviteLastName}
                  />
                </View>
                <ScrollView
                  horizontal
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                >
                  {roles
                    .filter(
                      (role) => currentUserRole === 'OWNER' || role !== 'OWNER',
                    )
                    .map((role) => (
                      <Pressable
                        accessibilityLabel={`Select ${roleLabel(role)} role`}
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
                <View style={styles.modalActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isBusy}
                    onPress={closeModal}
                    style={[styles.modalSecondary, isBusy && styles.pressed]}
                  >
                    <Text style={styles.modalSecondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isBusy}
                    onPress={onInvite}
                    style={[styles.modalPrimary, isBusy && styles.pressed]}
                  >
                    {isBusy ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : null}
                    <Text style={styles.modalPrimaryText}>
                      {isBusy ? 'Creating invite...' : 'Create invite'}
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ActionMenu({
  anchor,
  member,
  onCancelInvite,
  onChangeRole,
  onClose,
  onCopyInvite,
  onDelete,
  onReactivate,
  onResend,
  onSuspend,
  onViewProfile,
  windowHeight,
  windowWidth,
}: {
  anchor: MenuAnchor | null;
  member: TeamMember | null;
  onCancelInvite(member: TeamMember): void;
  onChangeRole(member: TeamMember): void;
  onClose(): void;
  onCopyInvite(member: TeamMember): void;
  onDelete(member: TeamMember): void;
  onReactivate(member: TeamMember): void;
  onResend(member: TeamMember): void;
  onSuspend(member: TeamMember): void;
  onViewProfile(member: TeamMember): void;
  windowHeight: number;
  windowWidth: number;
}) {
  if (!member) return null;

  const items =
    member.status === 'INVITED'
      ? [
          ['View invite', () => onViewProfile(member), false],
          ['Resend invite', () => onResend(member), false],
          ['Copy invite link', () => onCopyInvite(member), false],
          ['Cancel invite', () => onCancelInvite(member), true],
        ]
      : [
          ['View profile', () => onViewProfile(member), false],
          ['Change role', () => onChangeRole(member), false],
          [
            member.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend',
            () =>
              member.status === 'SUSPENDED'
                ? onReactivate(member)
                : onSuspend(member),
            false,
          ],
          ['Delete', () => onDelete(member), true],
        ];

  const menuWidth = 230;
  const menuHeight = member.status === 'INVITED' ? 224 : 224;
  const gap = 8;
  const margin = 12;
  const fallbackTop = 120;
  const topCandidate = anchor ? anchor.y + anchor.height + gap : fallbackTop;
  const shouldOpenAbove =
    anchor && topCandidate + menuHeight > windowHeight - margin;
  const top = anchor
    ? Math.max(
        margin,
        shouldOpenAbove ? anchor.y - menuHeight - gap : topCandidate,
      )
    : fallbackTop;
  const left = anchor
    ? Math.min(
        Math.max(margin, anchor.x + anchor.width - menuWidth),
        windowWidth - menuWidth - margin,
      )
    : windowWidth - menuWidth - margin;

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable style={styles.menuBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.overlayMenu, { left, top, width: menuWidth }]}
        >
          {items.map(([label, action, destructive]) => (
            <Pressable
              accessibilityLabel={String(label)}
              accessibilityRole="button"
              key={String(label)}
              onPress={() => {
                onClose();
                (action as () => void)();
              }}
              style={styles.menuItem}
            >
              <Text
                style={[
                  styles.menuText,
                  destructive ? styles.menuDanger : null,
                ]}
              >
                {String(label)}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RoleModal({
  busy,
  currentUserRole,
  member,
  onApply,
  onClose,
  selectedRole,
  setSelectedRole,
}: {
  busy: boolean;
  currentUserRole?: BusinessRole;
  member: TeamMember | null;
  onApply(): void;
  onClose(): void;
  selectedRole: BusinessRole;
  setSelectedRole(role: BusinessRole): void;
}) {
  if (!member) return null;

  const allowedRoles = roles.filter(
    (role) => currentUserRole === 'OWNER' || role !== 'OWNER',
  );

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.roleModal}>
          <Text style={styles.modalTitle}>Change role</Text>
          <Text style={styles.modalBody}>
            Current role: {roleLabel(member.role)}
          </Text>
          <ScrollView style={styles.roleList}>
            {allowedRoles.map((role) => (
              <Pressable
                accessibilityLabel={`Change role to ${roleLabel(role)}`}
                accessibilityRole="button"
                key={role}
                onPress={() => setSelectedRole(role)}
                style={[
                  styles.roleOption,
                  selectedRole === role && styles.roleOptionActive,
                ]}
              >
                <Text style={styles.roleOptionTitle}>{roleLabel(role)}</Text>
                <Text style={styles.roleOptionBody}>
                  {roleDescriptions[role]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={styles.modalSecondary}
            >
              <Text style={styles.modalSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || selectedRole === member.role}
              onPress={onApply}
              style={[
                styles.modalPrimary,
                (busy || selectedRole === member.role) && styles.pressed,
              ]}
            >
              <Text style={styles.modalPrimaryText}>
                {busy ? 'Saving...' : 'Confirm role'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  banner: {
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 16,
  },
  successBanner: { backgroundColor: '#ECFDF5', borderColor: '#BBF7D0' },
  warningBanner: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  errorBanner: { backgroundColor: '#FFF1F2', borderColor: '#FECDD3' },
  bannerTitle: { color: colours.ink, fontSize: 16, fontWeight: '800' },
  bannerBody: { color: colours.muted, lineHeight: 20, marginTop: 4 },
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
  resultCount: { color: colours.muted, fontWeight: '700', marginTop: 12 },
  filterRow: { gap: 8, paddingVertical: 10 },
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
  topInviteButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colours.primary,
    borderRadius: 999,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  topInviteButtonText: { color: '#FFFFFF', fontWeight: '900' },
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
  helperText: { color: colours.muted, lineHeight: 20 },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputError: { borderColor: '#E11D48', borderWidth: 2 },
  fieldError: {
    color: '#BE123C',
    fontSize: 13,
    fontWeight: '700',
    marginTop: -4,
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
  rolePickerActive: {
    backgroundColor: '#EEF2FF',
    borderColor: colours.primary,
  },
  rolePickerText: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  rolePickerTextActive: { color: colours.primary },
  inviteButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  inviteButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.55 },
  inviteUrlBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
  },
  inviteUrlLabel: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  inviteUrl: { color: colours.primary, lineHeight: 20, marginTop: 4 },
  inviteUrlActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  smallLinkButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallLinkButtonText: { color: colours.primary, fontWeight: '800' },
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
  highlightedCard: { borderColor: colours.primary, borderWidth: 2 },
  memberHeader: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: { color: colours.primary, fontSize: 18, fontWeight: '800' },
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
  menuButton: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 46,
  },
  menuButtonText: { color: colours.primary, fontSize: 18, fontWeight: '900' },
  menuBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.04)',
    flex: 1,
  },
  overlayMenu: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 220,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  menuItem: { paddingHorizontal: 16, paddingVertical: 15 },
  menuText: { color: colours.ink, fontSize: 16, fontWeight: '700' },
  menuDanger: { color: '#9F1239' },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalKeyboardAvoider: { flex: 1 },
  inviteModalScroll: {
    alignSelf: 'stretch',
    width: '100%',
  },
  inviteModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  inviteModalTouchLayer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  confirmCard: {
    backgroundColor: colours.card,
    borderRadius: 22,
    maxWidth: 520,
    padding: 20,
    width: '100%',
  },
  roleModal: {
    backgroundColor: colours.card,
    borderRadius: 22,
    maxHeight: '86%',
    maxWidth: 620,
    padding: 20,
    width: '100%',
  },
  inviteModal: {
    alignSelf: 'center',
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 12,
    maxWidth: 620,
    padding: 20,
    width: '100%',
  },
  modalTitle: { color: colours.ink, fontSize: 22, fontWeight: '800' },
  modalBody: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  modalSecondary: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalSecondaryText: { color: colours.muted, fontWeight: '800' },
  modalPrimary: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  modalDanger: { backgroundColor: '#9F1239' },
  modalPrimaryText: { color: '#FFFFFF', fontWeight: '800' },
  roleList: { marginTop: 12 },
  roleOption: {
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  roleOptionActive: {
    backgroundColor: '#EEF2FF',
    borderColor: colours.primary,
  },
  roleOptionTitle: { color: colours.ink, fontSize: 16, fontWeight: '800' },
  roleOptionBody: { color: colours.muted, lineHeight: 20, marginTop: 4 },
  memberProgress: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 10,
  },
  memberProgressText: { color: colours.muted, fontWeight: '700' },
  loadingBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 24,
    gap: 14,
    maxWidth: 360,
    padding: 24,
    width: '100%',
  },
  loadingText: {
    color: colours.ink,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
});
