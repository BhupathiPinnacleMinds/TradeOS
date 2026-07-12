import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateMemberStatusDto,
} from './dto/members.dto';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  findAll(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.members.findAll(currentUser);
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.members.findOne(currentUser, id);
  }

  @Post('invite')
  invite(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.members.invite(currentUser, dto);
  }

  @Patch(':id/role')
  updateRole(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.members.updateRole(currentUser, id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemberStatusDto,
  ) {
    return this.members.updateStatus(currentUser, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.members.remove(currentUser, id);
  }
}
