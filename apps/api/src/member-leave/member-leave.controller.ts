import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MemberLeaveDto } from './dto/member-leave.dto';
import { MemberLeaveService } from './member-leave.service';

@Controller()
export class MemberLeaveController {
  constructor(private readonly memberLeave: MemberLeaveService) {}

  @Get('me/leave')
  myLeave(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.memberLeave.findOwnLeave(currentUser);
  }

  @Post('me/leave')
  createMyLeave(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: MemberLeaveDto,
  ) {
    return this.memberLeave.createOwnLeave(currentUser, dto);
  }

  @Patch('me/leave/:leaveId')
  updateMyLeave(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('leaveId') leaveId: string,
    @Body() dto: MemberLeaveDto,
  ) {
    return this.memberLeave.updateOwnLeave(currentUser, leaveId, dto);
  }

  @Post('me/leave/:leaveId/cancel')
  cancelMyLeave(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('leaveId') leaveId: string,
  ) {
    return this.memberLeave.cancelOwnLeave(currentUser, leaveId);
  }

  @Get('team/leave')
  teamLeave(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.memberLeave.findTeamLeave(currentUser);
  }
}
