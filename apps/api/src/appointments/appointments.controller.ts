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
import { AppointmentsService } from './appointments.service';
import {
  AppointmentAvailabilityDto,
  AppointmentWorkLogDto,
  CaptureAppointmentSignatureDto,
  CompleteAppointmentDto,
  AppointmentRecommendationDto,
  DispatcherQueryDto,
  ListAppointmentsQueryDto,
  ReassignAppointmentDto,
  SkipAppointmentSignatureDto,
  UpsertAppointmentDto,
} from './dto/appointments.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListAppointmentsQueryDto,
  ) {
    return this.appointments.findAll(currentUser, query);
  }

  @Post('recommend')
  recommend(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: AppointmentRecommendationDto,
  ) {
    return this.appointments.recommend(currentUser, dto);
  }

  @Post('availability')
  availability(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: AppointmentAvailabilityDto,
  ) {
    return this.appointments.availability(currentUser, dto);
  }

  @Get('dispatcher')
  dispatcher(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: DispatcherQueryDto,
  ) {
    return this.appointments.dispatcher(currentUser, query);
  }

  @Get('my-day')
  myDay(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.appointments.myDay(currentUser);
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.findOne(currentUser, id);
  }

  @Get(':id/reassignment-options')
  reassignmentOptions(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.reassignmentOptions(currentUser, id);
  }

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpsertAppointmentDto,
  ) {
    return this.appointments.create(currentUser, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertAppointmentDto,
  ) {
    return this.appointments.update(currentUser, id, dto);
  }

  @Patch(':id/reassign')
  reassign(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReassignAppointmentDto,
  ) {
    return this.appointments.reassign(currentUser, id, dto);
  }

  @Post(':id/start')
  start(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.transition(currentUser, id, 'IN_PROGRESS');
  }

  @Post(':id/confirm')
  confirm(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.transition(currentUser, id, 'CONFIRMED');
  }

  @Post(':id/start-travel')
  startTravel(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.transition(currentUser, id, 'ON_THE_WAY');
  }

  @Post(':id/arrive')
  arrive(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.transition(currentUser, id, 'ARRIVED');
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CompleteAppointmentDto,
  ) {
    return this.appointments.completeWithWorkLog(currentUser, id, dto);
  }

  @Post(':id/pause')
  pause(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.transition(currentUser, id, 'PAUSED');
  }

  @Post(':id/resume')
  resume(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.transition(currentUser, id, 'IN_PROGRESS');
  }

  @Post(':id/signature')
  captureSignature(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CaptureAppointmentSignatureDto,
  ) {
    return this.appointments.captureSignature(currentUser, id, dto);
  }

  @Post(':id/signature/skip')
  skipSignature(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SkipAppointmentSignatureDto,
  ) {
    return this.appointments.skipSignature(currentUser, id, dto);
  }

  @Patch(':id/work-log')
  updateWorkLog(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AppointmentWorkLogDto,
  ) {
    return this.appointments.updateWorkLog(currentUser, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointments.transition(currentUser, id, 'CANCELLED');
  }
}
