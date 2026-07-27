import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CompleteUploadDto,
  CreateUploadTargetDto,
  ListMediaQueryDto,
  LocalUploadDto,
  UpdateMediaDto,
} from './dto/media.dto';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload-target')
  createUploadTarget(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateUploadTargetDto,
  ) {
    return this.media.createUploadTarget(currentUser, dto);
  }

  @Post(':id/local-upload')
  localUpload(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LocalUploadDto,
  ) {
    return this.media.localUpload(currentUser, id, dto);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.media.complete(currentUser, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.media.cancel(currentUser, id);
  }

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListMediaQueryDto,
  ) {
    return this.media.findAll(currentUser, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.media.findOne(currentUser, id);
  }

  @Get(':id/download')
  download(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.media.download(currentUser, id);
  }

  @Get(':id/preview')
  preview(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.media.preview(currentUser, id);
  }

  @Get(':id/file')
  async file(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const file = await this.media.file(currentUser, id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/"/g, '')}"`,
    );
    return response.send(file.content);
  }

  @Patch(':id')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
  ) {
    return this.media.update(currentUser, id, dto);
  }

  @Post(':id/archive')
  archive(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.media.archive(currentUser, id);
  }

  @Post(':id/restore')
  restore(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.media.restore(currentUser, id);
  }
}
