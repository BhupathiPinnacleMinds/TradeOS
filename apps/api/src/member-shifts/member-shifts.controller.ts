import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MemberShiftDto, MemberShiftQueryDto } from './dto/member-shift.dto';
import { MemberShiftsService } from './member-shifts.service';

@Controller('team/shifts')
export class MemberShiftsController {
  constructor(private readonly memberShifts: MemberShiftsService) {}

  @Get()
  teamShifts(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: MemberShiftQueryDto,
  ) {
    return this.memberShifts.findTeamShifts(currentUser, query);
  }

  @Post()
  createTeamShift(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: MemberShiftDto,
  ) {
    return this.memberShifts.createTeamShift(currentUser, dto);
  }

  @Patch(':shiftId')
  updateTeamShift(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('shiftId') shiftId: string,
    @Body() dto: MemberShiftDto,
  ) {
    return this.memberShifts.updateTeamShift(currentUser, shiftId, dto);
  }

  @Post(':shiftId/cancel')
  cancelTeamShift(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('shiftId') shiftId: string,
  ) {
    return this.memberShifts.cancelTeamShift(currentUser, shiftId);
  }
}
