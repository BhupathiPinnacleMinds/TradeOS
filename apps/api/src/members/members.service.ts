import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type {
  AuthenticatedUser,
  BusinessRole,
  InviteMemberResponse,
  TeamMember,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateMemberStatusDto,
} from './dto/members.dto';
import { NoopEmailProvider } from './email-provider';

const LEGACY_STAFF_ROLE: BusinessRole = 'STAFF';
const ACTIVE_MANAGEMENT_ROLES: BusinessRole[] = ['OWNER', 'ADMIN'];
const TEAM_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'READ_ONLY',
];

@Injectable()
export class MembersService {
  private readonly emailProvider = new NoopEmailProvider();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async findAll(currentUser: AuthenticatedUser): Promise<TeamMember[]> {
    this.assertCanViewTeam(currentUser);

    const members = await this.prisma.businessMember.findMany({
      where: { businessId: currentUser.businessId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: { user: true },
    });

    return members.map((member) => this.toTeamMember(member));
  }

  async findOne(currentUser: AuthenticatedUser, id: string) {
    this.assertCanViewTeam(currentUser);

    const member = await this.prisma.businessMember.findFirst({
      where: { id, businessId: currentUser.businessId },
      include: { user: true },
    });

    if (!member) {
      throw new NotFoundException('Team member not found');
    }

    const activity = await this.prisma.auditLog.findMany({
      where: {
        businessId: currentUser.businessId,
        entityType: 'BusinessMember',
        entityId: member.id,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      member: this.toTeamMember(member),
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
      throw new ForbiddenException('Admins cannot invite owners');
    }

    if (role === LEGACY_STAFF_ROLE) {
      throw new BadRequestException(
        'Choose a specific team role instead of STAFF',
      );
    }

    const business = await this.prisma.business.findUnique({
      where: { id: currentUser.businessId },
      select: { name: true },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const existingMember = await this.prisma.businessMember.findFirst({
      where: {
        businessId: currentUser.businessId,
        invitedEmail: email,
      },
      select: { id: true },
    });

    if (existingMember) {
      throw new ConflictException(
        'A team member already exists for this email',
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        businessId: currentUser.businessId,
        email,
      },
      select: { id: true },
    });

    const inviteToken = randomBytes(32).toString('hex');
    const inviteUrl = this.buildInviteUrl(inviteToken);

    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.businessMember.create({
        data: {
          businessId: currentUser.businessId,
          userId: existingUser?.id ?? null,
          invitedEmail: email,
          inviteToken,
          invitedBy: currentUser.id,
          invitedAt: new Date(),
          joinedAt: existingUser ? new Date() : null,
          role,
          status: existingUser ? 'ACTIVE' : 'INVITED',
        },
        include: { user: true },
      });

      if (existingUser) {
        await tx.user.update({
          where: { id: existingUser.id },
          data: { role, isActive: true },
        });
      }

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'MEMBER_INVITED',
          entityType: 'BusinessMember',
          entityId: created.id,
          metadata: { email, role, inviteUrl },
        },
      });

      return created;
    });

    await this.emailProvider.sendInvite({
      to: email,
      businessName: business.name,
      inviteUrl,
    });

    return {
      member: this.toTeamMember(member, inviteUrl),
      inviteToken,
      inviteUrl,
    };
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
      throw new ForbiddenException('Members cannot change their own role');
    }

    if (
      currentUser.role === 'ADMIN' &&
      (target.role === 'OWNER' || nextRole === 'OWNER')
    ) {
      throw new ForbiddenException('Admins cannot manage owners');
    }

    if (nextRole === LEGACY_STAFF_ROLE) {
      throw new BadRequestException(
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
      throw new ForbiddenException('Members cannot change their own status');
    }

    if (currentUser.role === 'ADMIN' && target.role === 'OWNER') {
      throw new ForbiddenException('Admins cannot manage owners');
    }

    if (dto.status === 'SUSPENDED') {
      await this.assertOwnerProtection(currentUser.businessId, target.id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.update({
        where: { id: target.id },
        data: {
          status: dto.status,
          inviteToken: dto.status === 'ACTIVE' ? null : target.inviteToken,
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
          data: { isActive: dto.status === 'ACTIVE' },
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
      throw new ForbiddenException('Members cannot remove themselves');
    }

    if (currentUser.role === 'ADMIN' && target.role === 'OWNER') {
      throw new ForbiddenException('Admins cannot manage owners');
    }

    await this.assertOwnerProtection(currentUser.businessId, target.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.businessMember.delete({ where: { id: target.id } });

      if (target.userId) {
        await tx.user.update({
          where: { id: target.userId },
          data: { isActive: false },
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
      throw new NotFoundException('Team member not found');
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
      throw new ForbiddenException('Cannot remove the last active owner');
    }
  }

  private assertCanViewTeam(currentUser: AuthenticatedUser) {
    if (!TEAM_VIEW_ROLES.includes(currentUser.role)) {
      throw new ForbiddenException('Insufficient team permissions');
    }
  }

  private assertCanManageTeam(currentUser: AuthenticatedUser) {
    if (!ACTIVE_MANAGEMENT_ROLES.includes(currentUser.role)) {
      throw new ForbiddenException('Insufficient team permissions');
    }
  }

  private normaliseRole(role: BusinessRole): BusinessRole {
    return role;
  }

  private buildInviteUrl(inviteToken: string) {
    const appUrl =
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('EXPO_PUBLIC_APP_URL') ??
      'http://localhost:8081';

    return `${appUrl.replace(/\/$/, '')}/invite/${inviteToken}`;
  }

  private toTeamMember(
    member: BusinessMemberWithUser,
    inviteUrl?: string,
  ): TeamMember {
    const name =
      member.user &&
      [member.user.firstName, member.user.lastName].filter(Boolean).join(' ');

    return {
      id: member.id,
      businessId: member.businessId,
      userId: member.userId,
      name: name || 'Invited member',
      email: member.user?.email ?? member.invitedEmail,
      role: member.role,
      status: member.status,
      invitedEmail: member.invitedEmail,
      inviteUrl:
        inviteUrl ??
        (member.inviteToken ? this.buildInviteUrl(member.inviteToken) : null),
      invitedBy: member.invitedBy,
      invitedAt: member.invitedAt?.toISOString() ?? null,
      joinedAt: member.joinedAt?.toISOString() ?? null,
      lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
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
