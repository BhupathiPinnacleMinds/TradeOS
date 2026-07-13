import type { BusinessRole } from './auth';

export const MEMBER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface TeamMember {
  id: string;
  businessId: string;
  userId: string | null;
  name: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: BusinessRole;
  status: MemberStatus;
  invitedEmail: string;
  invitedFirstName: string | null;
  invitedLastName: string | null;
  inviteUrl: string | null;
  inviteExpiresAt: string | null;
  inviteAcceptedAt: string | null;
  inviteCancelledAt: string | null;
  inviteEmailDeliveryStatus: string | null;
  inviteEmailDeliveryError: string | null;
  invitedBy: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InviteMemberRequest {
  email: string;
  firstName: string;
  lastName: string;
  role: BusinessRole;
}

export interface InviteMemberResponse {
  member: TeamMember;
  inviteToken: string;
  inviteUrl: string;
}

export type InvitationState =
  'VALID' | 'INVALID' | 'EXPIRED' | 'ACCEPTED' | 'CANCELLED';

export interface InvitationPreviewResponse {
  state: InvitationState;
  businessName?: string;
  invitedEmail?: string;
  role?: BusinessRole;
  expiresAt?: string;
}

export interface AcceptInvitationRequest {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

export interface ResendInvitationResponse {
  member: TeamMember;
  inviteToken: string;
  inviteUrl: string;
}

export interface UpdateMemberRoleRequest {
  role: BusinessRole;
}

export interface UpdateMemberStatusRequest {
  status: Extract<MemberStatus, 'ACTIVE' | 'SUSPENDED'>;
}

export interface AuditLogEntry {
  id: string;
  businessId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface TeamMemberDetailResponse {
  member: TeamMember;
  activity: AuditLogEntry[];
  assignedJobsCount: number;
  businessName: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
