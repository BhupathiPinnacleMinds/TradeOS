import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, scrypt as scryptCallback } from 'crypto';
import { promisify } from 'util';
import type {
  AuthResponse,
  AuthenticatedUser,
  BusinessRole,
  InvitationPreviewResponse,
  InviteMemberResponse,
  ResendInvitationResponse,
  TeamMember,
  TeamMemberDetailResponse,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AcceptInvitationDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateMemberStatusDto,
} from './dto/members.dto';
import { createEmailProvider, type EmailProvider } from './email-provider';

const scrypt = promisify(scryptCallback);
const LEGACY_STAFF_ROLE: BusinessRole = 'STAFF';
const ACTIVE_MANAGEMENT_ROLES: BusinessRole[] = ['OWNER', 'ADMIN'];
const TEAM_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'READ_ONLY',
];
const INVITE_EXPIRY_DAYS = 7;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 20;

@Injectable()
export class MembersService {
  private readonly emailProvider: EmailProvider;
  private readonly rateLimitBuckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {
    this.emailProvider = createEmailProvider({
      apiKey: this.config.get<string>('RESEND_API_KEY'),
      fromAddress: this.config.get<string>('EMAIL_FROM_ADDRESS'),
      fromName: this.config.get<string>('EMAIL_FROM_NAME', 'TradieOS'),
      isProduction: this.config.get<string>('NODE_ENV') === 'production',
      provider: this.config.get<string>('EMAIL_PROVIDER', 'console'),
    });
  }

  async findAll(currentUser: AuthenticatedUser): Promise<TeamMember[]> {
    this.assertCanViewTeam(currentUser);

    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId: currentUser.businessId,
        inviteCancelledAt: null,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: { user: true },
    });

    return members.map((member) => this.toTeamMember(member));
  }

  async findOne(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<TeamMemberDetailResponse> {
    this.assertCanViewTeam(currentUser);

    const member = await this.prisma.businessMember.findFirst({
      where: { id, businessId: currentUser.businessId },
      include: { user: true },
    });

    if (!member) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'MEMBER_NOT_FOUND',
        'Team member not found',
      );
    }

    const [activity, assignedJobsCount, business] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          businessId: currentUser.businessId,
          entityType: 'BusinessMember',
          entityId: member.id,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.job.count({
        where: { businessId: currentUser.businessId },
      }),
      this.prisma.business.findUnique({
        where: { id: currentUser.businessId },
        select: { name: true },
      }),
    ]);

    return {
      member: this.toTeamMember(member),
      assignedJobsCount,
      businessName: business?.name ?? 'This business',
      activity: activity.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      })),
    };
  }

  async invite(
    currentUser: AuthenticatedUser,
    dto: InviteMemberDto,
  ): Promise<InviteMemberResponse> {
    this.assertCanManageTeam(currentUser);

    const email = dto.email.trim().toLowerCase();
    const role = this.normaliseRole(dto.role);

    if (currentUser.role === 'ADMIN' && role === 'OWNER') {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'Only an owner can invite another owner.',
      );
    }

    if (role === LEGACY_STAFF_ROLE) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Choose a specific team role instead of STAFF',
      );
    }

    const business = await this.prisma.business.findUnique({
      where: { id: currentUser.businessId },
      select: {
        name: true,
        users: {
          where: { id: currentUser.id },
          select: { firstName: true, lastName: true },
          take: 1,
        },
      },
    });

    if (!business) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'BUSINESS_NOT_FOUND',
        'Business not found',
      );
    }

    const existingMember = await this.prisma.businessMember.findFirst({
      where: {
        businessId: currentUser.businessId,
        invitedEmail: email,
      },
      select: {
        id: true,
        status: true,
        role: true,
        invitedEmail: true,
        invitedAt: true,
        inviteExpiresAt: true,
        inviteTokenHash: true,
        inviteCancelledAt: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    const reusableCancelledInvite =
      existingMember?.status === 'INVITED' && existingMember.inviteCancelledAt
        ? existingMember
        : null;

    if (existingMember && !reusableCancelledInvite) {
      throw this.duplicateMemberError(existingMember);
    }

    const invite = this.createInvite();
    const inviteUrl = this.buildInviteUrl(invite.token);

    const member = await this.prisma.$transaction(async (tx) => {
      const created = reusableCancelledInvite
        ? await tx.businessMember.update({
            where: { id: reusableCancelledInvite.id },
            data: {
              userId: null,
              invitedEmail: email,
              invitedFirstName: dto.firstName.trim(),
              invitedLastName: dto.lastName.trim(),
              inviteTokenHash: invite.tokenHash,
              inviteExpiresAt: invite.expiresAt,
              inviteAcceptedAt: null,
              inviteCancelledAt: null,
              invitedBy: currentUser.id,
              invitedAt: new Date(),
              inviteEmailDeliveryStatus: 'PENDING',
              inviteEmailDeliveryError: null,
              role,
              status: 'INVITED',
            },
            include: { user: true },
          })
        : await tx.businessMember.create({
            data: {
              businessId: currentUser.businessId,
              userId: null,
              invitedEmail: email,
              invitedFirstName: dto.firstName.trim(),
              invitedLastName: dto.lastName.trim(),
              inviteTokenHash: invite.tokenHash,
              inviteExpiresAt: invite.expiresAt,
              invitedBy: currentUser.id,
              invitedAt: new Date(),
              inviteEmailDeliveryStatus: 'PENDING',
              inviteEmailDeliveryError: null,
              role,
              status: 'INVITED',
            },
            include: { user: true },
          });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'INVITE_CREATED',
          entityType: 'BusinessMember',
          entityId: created.id,
          metadata: {
            email,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            role,
            inviteExpiresAt: invite.expiresAt,
            reusedCancelledInvite: Boolean(reusableCancelledInvite),
          },
        },
      });

      return created;
    });

    const delivery = await this.emailProvider.sendTeamInvitation({
      to: email,
      businessName: business.name,
      expiresAt: invite.expiresAt,
      inviterName: this.inviterName(currentUser, business.users?.[0]),
      inviteUrl,
      role,
    });
    const memberWithDelivery = await this.recordInviteDelivery({
      actorUserId: currentUser.id,
      delivery,
      memberId: member.id,
    });

    const exposedInvite = this.exposedInvite(invite.token, inviteUrl);

    return {
      member: this.toTeamMember(memberWithDelivery, exposedInvite.inviteUrl),
      inviteToken: exposedInvite.inviteToken,
      inviteUrl: exposedInvite.inviteUrl,
    };
  }

  async previewInvitation(token: string): Promise<InvitationPreviewResponse> {
    this.assertInviteRateLimit(`preview:${token}`);

    const invitation = await this.findInvitationByToken(token);

    if (!invitation) {
      return { state: 'INVALID' };
    }

    await this.prisma.auditLog.create({
      data: {
        businessId: invitation.businessId,
        action: 'INVITE_VIEWED',
        entityType: 'BusinessMember',
        entityId: invitation.id,
        metadata: { invitedEmail: invitation.invitedEmail },
      },
    });

    const state = this.invitationState(invitation);

    return {
      state,
      businessName: invitation.business.name,
      invitedEmail: invitation.invitedEmail,
      role: invitation.role,
      expiresAt: invitation.inviteExpiresAt?.toISOString(),
    };
  }

  async acceptInvitation(
    token: string,
    dto: AcceptInvitationDto,
  ): Promise<AuthResponse> {
    this.assertInviteRateLimit(`accept:${token}`);

    if (dto.password !== dto.confirmPassword) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Passwords do not match.',
      );
    }

    const email = dto.email.trim().toLowerCase();
    const tokenHash = this.hashInviteToken(token);
    const invitation = await this.prisma.businessMember.findFirst({
      where: { inviteTokenHash: tokenHash },
      include: { business: true, user: true },
    });

    if (!invitation) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'INVITE_NOT_FOUND',
        'Invitation not found',
      );
    }

    const state = this.invitationState(invitation);
    if (state !== 'VALID') {
      throw this.invitationStateError(state);
    }

    if (invitation.invitedEmail.trim().toLowerCase() !== email) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INVITE_EMAIL_MISMATCH',
        'Invitation email does not match.',
      );
    }

    const passwordHash = await this.hashPassword(dto.password);
    const acceptedAt = new Date();

    const user = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: { email },
        select: {
          id: true,
          businessId: true,
        },
      });

      if (existingUser && existingUser.businessId !== invitation.businessId) {
        throw this.domainError(
          HttpStatus.CONFLICT,
          'EMAIL_IN_OTHER_WORKSPACE',
          'This email already belongs to another workspace',
        );
      }

      const linkedUser = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              passwordHash,
              role: invitation.role,
              isActive: true,
              authVersion: { increment: 1 },
            },
            select: this.userSelect(),
          })
        : await tx.user.create({
            data: {
              businessId: invitation.businessId,
              email,
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              passwordHash,
              role: invitation.role,
              isActive: true,
            },
            select: this.userSelect(),
          });

      await tx.businessMember.update({
        where: { id: invitation.id },
        data: {
          userId: linkedUser.id,
          status: 'ACTIVE',
          inviteTokenHash: null,
          inviteAcceptedAt: acceptedAt,
          joinedAt: acceptedAt,
        },
      });

      await tx.auditLog.createMany({
        data: [
          {
            businessId: invitation.businessId,
            actorUserId: linkedUser.id,
            action: 'INVITE_ACCEPTED',
            entityType: 'BusinessMember',
            entityId: invitation.id,
            metadata: { invitedEmail: invitation.invitedEmail },
          },
          {
            businessId: invitation.businessId,
            actorUserId: linkedUser.id,
            action: 'MEMBER_ACTIVATED',
            entityType: 'BusinessMember',
            entityId: invitation.id,
            metadata: { role: invitation.role },
          },
        ],
      });

      return linkedUser;
    });

    return this.authResponse(user);
  }

  async resendInvite(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<ResendInvitationResponse> {
    this.assertCanManageTeam(currentUser);

    const target = await this.getManagedMember(currentUser, id);
    if (target.status !== 'INVITED' || target.inviteCancelledAt) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVITE_NOT_RESENDABLE',
        'Only pending invitations can be resent.',
      );
    }

    const business = await this.prisma.business.findUnique({
      where: { id: currentUser.businessId },
      select: {
        name: true,
        users: {
          where: { id: currentUser.id },
          select: { firstName: true, lastName: true },
          take: 1,
        },
      },
    });
    if (!business) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'BUSINESS_NOT_FOUND',
        'Business not found',
      );
    }

    const invite = this.createInvite();
    const inviteUrl = this.buildInviteUrl(invite.token);
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.update({
        where: { id: target.id },
        data: {
          inviteTokenHash: invite.tokenHash,
          inviteExpiresAt: invite.expiresAt,
          invitedAt: new Date(),
          inviteAcceptedAt: null,
          inviteCancelledAt: null,
          inviteEmailDeliveryStatus: 'PENDING',
          inviteEmailDeliveryError: null,
        },
        include: { user: true },
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'INVITE_RESENT',
          entityType: 'BusinessMember',
          entityId: member.id,
          metadata: {
            invitedEmail: member.invitedEmail,
            inviteExpiresAt: invite.expiresAt,
          },
        },
      });

      return member;
    });
    const delivery = await this.emailProvider.resendTeamInvitation({
      businessName: business.name,
      expiresAt: invite.expiresAt,
      inviteUrl,
      inviterName: this.inviterName(currentUser, business.users?.[0]),
      role: updated.role,
      to: updated.invitedEmail,
    });
    const memberWithDelivery = await this.recordInviteDelivery({
      actorUserId: currentUser.id,
      delivery,
      memberId: updated.id,
      resent: true,
    });

    const exposedInvite = this.exposedInvite(invite.token, inviteUrl);

    return {
      member: this.toTeamMember(memberWithDelivery, exposedInvite.inviteUrl),
      inviteToken: exposedInvite.inviteToken,
      inviteUrl: exposedInvite.inviteUrl,
    };
  }

  async cancelInvite(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<TeamMember> {
    this.assertCanManageTeam(currentUser);

    const target = await this.getManagedMember(currentUser, id);
    if (target.status !== 'INVITED' || target.inviteAcceptedAt) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVITE_NOT_CANCELLABLE',
        'Only pending invitations can be cancelled',
      );
    }

    const cancelledAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.update({
        where: { id: target.id },
        data: {
          inviteTokenHash: null,
          inviteCancelledAt: cancelledAt,
          inviteEmailDeliveryStatus: 'CANCELLED',
          inviteEmailDeliveryError: null,
        },
        include: { user: true },
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'INVITE_CANCELLED',
          entityType: 'BusinessMember',
          entityId: member.id,
          metadata: { invitedEmail: member.invitedEmail },
        },
      });

      return member;
    });

    return this.toTeamMember(updated);
  }

  async updateRole(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpdateMemberRoleDto,
  ): Promise<TeamMember> {
    this.assertCanManageTeam(currentUser);

    const target = await this.getManagedMember(currentUser, id);
    const nextRole = this.normaliseRole(dto.role);

    if (target.userId === currentUser.id) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'CANNOT_CHANGE_OWN_ROLE',
        'You cannot change your own role.',
      );
    }

    if (
      currentUser.role === 'ADMIN' &&
      (target.role === 'OWNER' || nextRole === 'OWNER')
    ) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'Admins cannot manage owner members.',
      );
    }

    if (nextRole === LEGACY_STAFF_ROLE) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Choose a specific team role instead of STAFF',
      );
    }

    await this.assertOwnerProtection(
      currentUser.businessId,
      target.id,
      nextRole,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.update({
        where: { id: target.id },
        data: { role: nextRole },
        include: { user: true },
      });

      if (member.userId) {
        await tx.user.update({
          where: { id: member.userId },
          data: { role: nextRole },
        });
      }

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'ROLE_CHANGED',
          entityType: 'BusinessMember',
          entityId: member.id,
          metadata: { from: target.role, to: nextRole },
        },
      });

      return member;
    });

    return this.toTeamMember(updated);
  }

  async updateStatus(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpdateMemberStatusDto,
  ): Promise<TeamMember> {
    this.assertCanManageTeam(currentUser);

    const target = await this.getManagedMember(currentUser, id);

    if (target.userId === currentUser.id) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'CANNOT_CHANGE_OWN_STATUS',
        'You cannot suspend or reactivate yourself.',
      );
    }

    if (currentUser.role === 'ADMIN' && target.role === 'OWNER') {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'Admins cannot manage owner members.',
      );
    }

    if (dto.status === 'SUSPENDED') {
      await this.assertOwnerProtection(currentUser.businessId, target.id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.update({
        where: { id: target.id },
        data: {
          status: dto.status,
          inviteTokenHash:
            dto.status === 'ACTIVE' ? null : target.inviteTokenHash,
          inviteAcceptedAt:
            dto.status === 'ACTIVE' && !target.inviteAcceptedAt
              ? new Date()
              : target.inviteAcceptedAt,
          joinedAt:
            dto.status === 'ACTIVE' && !target.joinedAt
              ? new Date()
              : target.joinedAt,
        },
        include: { user: true },
      });

      if (member.userId) {
        await tx.user.update({
          where: { id: member.userId },
          data: {
            isActive: dto.status === 'ACTIVE',
            authVersion: { increment: 1 },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action:
            dto.status === 'SUSPENDED'
              ? 'MEMBER_SUSPENDED'
              : 'MEMBER_REACTIVATED',
          entityType: 'BusinessMember',
          entityId: member.id,
          metadata: { from: target.status, to: dto.status },
        },
      });

      return member;
    });

    return this.toTeamMember(updated);
  }

  async remove(currentUser: AuthenticatedUser, id: string): Promise<void> {
    this.assertCanManageTeam(currentUser);

    const target = await this.getManagedMember(currentUser, id);

    if (target.userId === currentUser.id) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'CANNOT_REMOVE_SELF',
        'You cannot remove yourself from the workspace.',
      );
    }

    if (currentUser.role === 'ADMIN' && target.role === 'OWNER') {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'Admins cannot manage owner members.',
      );
    }

    await this.assertOwnerProtection(currentUser.businessId, target.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.businessMember.delete({ where: { id: target.id } });

      if (target.userId) {
        await tx.user.update({
          where: { id: target.userId },
          data: { isActive: false, authVersion: { increment: 1 } },
        });
      }

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'MEMBER_REMOVED',
          entityType: 'BusinessMember',
          entityId: target.id,
          metadata: {
            email: target.invitedEmail,
            role: target.role,
            userId: target.userId,
          },
        },
      });
    });
  }

  private async getManagedMember(currentUser: AuthenticatedUser, id: string) {
    const member = await this.prisma.businessMember.findFirst({
      where: { id, businessId: currentUser.businessId },
      include: { user: true },
    });

    if (!member) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'MEMBER_NOT_FOUND',
        'Team member not found',
      );
    }

    return member;
  }

  private async assertOwnerProtection(
    businessId: string,
    targetMemberId: string,
    nextRole?: BusinessRole,
  ) {
    const target = await this.prisma.businessMember.findFirst({
      where: { id: targetMemberId, businessId },
      select: { role: true, status: true },
    });

    if (!target || target.role !== 'OWNER' || target.status !== 'ACTIVE') {
      return;
    }

    if (nextRole === 'OWNER') {
      return;
    }

    const activeOwnerCount = await this.prisma.businessMember.count({
      where: { businessId, role: 'OWNER', status: 'ACTIVE' },
    });

    if (activeOwnerCount <= 1) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'LAST_OWNER_PROTECTED',
        'Cannot remove or demote the last active owner.',
      );
    }
  }

  private assertCanViewTeam(currentUser: AuthenticatedUser) {
    if (!TEAM_VIEW_ROLES.includes(currentUser.role)) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'You do not have permission to view team members.',
      );
    }
  }

  private assertCanManageTeam(currentUser: AuthenticatedUser) {
    if (!ACTIVE_MANAGEMENT_ROLES.includes(currentUser.role)) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'You do not have permission to manage team members.',
      );
    }
  }

  private normaliseRole(role: BusinessRole): BusinessRole {
    return role;
  }

  private createInvite() {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    return {
      token,
      tokenHash: this.hashInviteToken(token),
      expiresAt,
    };
  }

  private hashInviteToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async findInvitationByToken(token: string) {
    return this.prisma.businessMember.findFirst({
      where: { inviteTokenHash: this.hashInviteToken(token) },
      include: { business: true, user: true },
    });
  }

  private invitationState(invitation: InvitationRecord) {
    if (invitation.inviteCancelledAt) {
      return 'CANCELLED' as const;
    }

    if (invitation.inviteAcceptedAt || invitation.status === 'ACTIVE') {
      return 'ACCEPTED' as const;
    }

    if (invitation.status === 'SUSPENDED') {
      return 'CANCELLED' as const;
    }

    if (
      !invitation.inviteExpiresAt ||
      invitation.inviteExpiresAt.getTime() < Date.now()
    ) {
      return 'EXPIRED' as const;
    }

    return 'VALID' as const;
  }

  private assertInviteRateLimit(key: string) {
    const now = Date.now();
    const bucket = this.rateLimitBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.rateLimitBuckets.set(key, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      });
      return;
    }

    bucket.count += 1;

    if (bucket.count > RATE_LIMIT_MAX_ATTEMPTS) {
      throw this.domainError(
        HttpStatus.TOO_MANY_REQUESTS,
        'TOO_MANY_REQUESTS',
        'Too many invitation attempts',
      );
    }
  }

  private buildInviteUrl(inviteToken: string) {
    const appUrl =
      this.config.get<string>('APP_PUBLIC_URL') ??
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('EXPO_PUBLIC_APP_URL') ??
      'http://localhost:8081';

    return `${appUrl.replace(/\/$/, '')}/invite/${inviteToken}`;
  }

  private exposedInvite(inviteToken: string, inviteUrl: string) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      return {
        inviteToken: '',
        inviteUrl: '',
      };
    }

    return { inviteToken, inviteUrl };
  }

  private toTeamMember(
    member: BusinessMemberWithUser,
    inviteUrl?: string,
  ): TeamMember {
    const name =
      member.user &&
      [member.user.firstName, member.user.lastName].filter(Boolean).join(' ');
    const invitedName = [member.invitedFirstName, member.invitedLastName]
      .filter(Boolean)
      .join(' ');

    return {
      id: member.id,
      businessId: member.businessId,
      userId: member.userId,
      name: name || invitedName || 'Invited member',
      email: member.user?.email ?? member.invitedEmail,
      firstName: member.user?.firstName ?? member.invitedFirstName ?? null,
      lastName: member.user?.lastName ?? member.invitedLastName ?? null,
      role: member.role,
      status: member.status,
      invitedEmail: member.invitedEmail,
      invitedFirstName: member.invitedFirstName,
      invitedLastName: member.invitedLastName,
      inviteUrl: inviteUrl ?? null,
      inviteExpiresAt: member.inviteExpiresAt?.toISOString() ?? null,
      inviteAcceptedAt: member.inviteAcceptedAt?.toISOString() ?? null,
      inviteCancelledAt: member.inviteCancelledAt?.toISOString() ?? null,
      inviteEmailDeliveryStatus: member.inviteEmailDeliveryStatus,
      inviteEmailDeliveryError: member.inviteEmailDeliveryError,
      invitedBy: member.invitedBy,
      invitedAt: member.invitedAt?.toISOString() ?? null,
      joinedAt: member.joinedAt?.toISOString() ?? null,
      lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
  }

  private async authResponse(user: UserAuthPayload): Promise<AuthResponse> {
    const { authVersion, ...authUser } = user;
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        businessId: user.businessId,
        authVersion,
      },
      {
        expiresIn: 12 * 60 * 60,
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      },
    );

    return {
      accessToken,
      user: authUser,
    };
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt:${salt}:${hash.toString('hex')}`;
  }

  private async recordInviteDelivery(input: {
    actorUserId: string;
    delivery: { error?: string; provider: string; status: 'SENT' | 'FAILED' };
    memberId: string;
    resent?: boolean;
  }): Promise<BusinessMemberWithUser> {
    const updated = await this.prisma.businessMember.update({
      where: { id: input.memberId },
      data: {
        inviteEmailDeliveryError: input.delivery.error ?? null,
        inviteEmailDeliveryStatus: input.delivery.status,
      },
      include: { user: true },
    });

    await this.prisma.auditLog.create({
      data: {
        businessId: updated.businessId,
        actorUserId: input.actorUserId,
        action:
          input.delivery.status === 'SENT'
            ? 'INVITE_EMAIL_SENT'
            : 'INVITE_EMAIL_FAILED',
        entityType: 'BusinessMember',
        entityId: updated.id,
        metadata: {
          error: input.delivery.error,
          provider: input.delivery.provider,
          resent: Boolean(input.resent),
        },
      },
    });

    if (input.delivery.status === 'FAILED') {
      throw this.domainError(
        HttpStatus.BAD_GATEWAY,
        'EMAIL_DELIVERY_FAILED',
        "We couldn't send the invitation email. Please try again.",
      );
    }

    return updated;
  }

  private inviterName(
    currentUser: AuthenticatedUser,
    user?: { firstName: string; lastName: string } | null,
  ) {
    const name = [
      user?.firstName ?? currentUser.firstName,
      user?.lastName ?? currentUser.lastName,
    ]
      .filter(Boolean)
      .join(' ');
    return name || currentUser.email;
  }

  private duplicateMemberError(existingMember: {
    id: string;
    status: string;
    role: BusinessRole;
    invitedEmail: string;
    invitedAt: Date | null;
    inviteExpiresAt: Date | null;
    inviteTokenHash: string | null;
    inviteCancelledAt: Date | null;
    user: { firstName: string; lastName: string; email: string } | null;
  }) {
    const details = {
      memberId: existingMember.id,
      status: existingMember.status,
      role: existingMember.role,
      email: existingMember.invitedEmail,
      invitedAt: existingMember.invitedAt?.toISOString() ?? null,
      inviteExpiresAt: existingMember.inviteExpiresAt?.toISOString() ?? null,
      canResendInvite:
        existingMember.status === 'INVITED' &&
        Boolean(existingMember.inviteTokenHash) &&
        !existingMember.inviteCancelledAt,
      canCancelInvite:
        existingMember.status === 'INVITED' &&
        !existingMember.inviteCancelledAt,
      canReactivate: existingMember.status === 'SUSPENDED',
    };

    if (existingMember.status === 'INVITED') {
      return this.domainError(
        HttpStatus.CONFLICT,
        'INVITE_ALREADY_PENDING',
        'An invitation is already pending for this email.',
        details,
      );
    }

    if (existingMember.status === 'ACTIVE') {
      return this.domainError(
        HttpStatus.CONFLICT,
        'MEMBER_ALREADY_ACTIVE',
        'This person is already an active member of this workspace.',
        details,
      );
    }

    return this.domainError(
      HttpStatus.CONFLICT,
      'MEMBER_SUSPENDED',
      'This member is suspended. Reactivate them instead of creating a new invite.',
      details,
    );
  }

  private invitationStateError(state: InvitationPreviewResponse['state']) {
    const mapping: Record<
      InvitationPreviewResponse['state'],
      { status: HttpStatus; code: string; message: string }
    > = {
      VALID: {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Invitation is already valid.',
      },
      INVALID: {
        status: HttpStatus.NOT_FOUND,
        code: 'INVITE_NOT_FOUND',
        message: 'Invitation not found.',
      },
      EXPIRED: {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVITE_EXPIRED',
        message: 'This invitation has expired.',
      },
      ACCEPTED: {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVITE_ALREADY_ACCEPTED',
        message: 'This invitation has already been accepted.',
      },
      CANCELLED: {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVITE_CANCELLED',
        message: 'This invitation has been cancelled.',
      },
    };
    const error = mapping[state];
    return this.domainError(error.status, error.code, error.message);
  }

  private domainError(
    status: HttpStatus,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    return new HttpException({ code, message, details }, status);
  }

  private userSelect() {
    return {
      id: true,
      businessId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      authVersion: true,
      business: {
        select: {
          id: true,
          name: true,
          abn: true,
          tradeType: true,
          gstRegistered: true,
          phone: true,
          email: true,
          address: true,
          suburb: true,
          state: true,
          postcode: true,
          timezone: true,
        },
      },
    } as const;
  }
}

type BusinessMemberWithUser = Awaited<
  ReturnType<PrismaService['businessMember']['findFirst']>
> & {
  user?: {
    firstName: string;
    lastName: string;
    email: string;
  } | null;
};

type InvitationRecord = NonNullable<
  Awaited<ReturnType<PrismaService['businessMember']['findFirst']>>
> & {
  business: {
    name: string;
  };
};

type UserAuthPayload = {
  id: string;
  businessId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: BusinessRole;
  isActive: boolean;
  authVersion: number;
  business: {
    id: string;
    name: string;
    abn: string | null;
    tradeType: string | null;
    gstRegistered: boolean;
    phone: string | null;
    email: string | null;
    address: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    timezone: string;
  };
};
