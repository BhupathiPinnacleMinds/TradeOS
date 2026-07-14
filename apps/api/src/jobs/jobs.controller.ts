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
import { JobsService } from './jobs.service';
import {
  ListJobsQueryDto,
  UpdateJobStatusDto,
  UpsertJobDto,
} from './dto/jobs.dto';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListJobsQueryDto,
  ) {
    return this.jobs.findAll(currentUser, query);
  }

  @Get('today')
  today(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.jobs.today(currentUser);
  }

  @Get('upcoming')
  upcoming(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.jobs.upcoming(currentUser);
  }

  @Get('assigned')
  assigned(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.jobs.assigned(currentUser);
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.jobs.findOne(currentUser, id);
  }

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpsertJobDto,
  ) {
    return this.jobs.create(currentUser, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertJobDto,
  ) {
    return this.jobs.update(currentUser, id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateJobStatusDto,
  ) {
    return this.jobs.updateStatus(currentUser, id, dto);
  }

  @Post(':id/archive')
  archive(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.jobs.archive(currentUser, id);
  }

  @Post(':id/restore')
  restore(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.jobs.restore(currentUser, id);
  }
}
