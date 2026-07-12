import type { BusinessRole } from './auth';

export const MEMBER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface TeamMember {
  id: string;
  businessId: string;
  userId: string | null;
  name: string;
  email: string;
  role: BusinessRole;
  status: MemberStatus;
  invitedEmail: string;
  inviteUrl: string | null;
  invitedBy: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InviteMemberRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  role: BusinessRole;
}

export interface InviteMemberResponse {
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
