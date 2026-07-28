import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import {
  DOCUMENT_LIMIT,
  MEDIA_MULTIPART_FILE_LIMIT,
  MediaService,
} from './media.service';

@Catch()
class MediaUploadExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const code = this.errorCode(exception);
    if (!code) {
      if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const body = exception.getResponse();
        response.status(status).json(
          typeof body === 'string'
            ? {
                code: status === 413 ? 'FILE_TOO_LARGE' : 'REQUEST_FAILED',
                message: body,
              }
            : body,
        );
        return;
      }
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: 'MEDIA_UPLOAD_FAILED',
        message: "We couldn't upload this file.",
      });
      return;
    }
    response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      code,
      details: {
        maximumBytes: DOCUMENT_LIMIT,
      },
      message: 'The selected file exceeds the upload limit.',
    });
  }

  private errorCode(exception: unknown) {
    const error = exception as {
      code?: string;
      message?: string;
      name?: string;
      status?: number;
      statusCode?: number;
    };
    if (error?.code === 'LIMIT_FILE_SIZE') return 'FILE_TOO_LARGE';
    if (
      error?.status === HttpStatus.PAYLOAD_TOO_LARGE ||
      error?.statusCode === HttpStatus.PAYLOAD_TOO_LARGE ||
      error?.name === 'PayloadTooLargeError'
    ) {
      return 'FILE_TOO_LARGE';
    }
    return null;
  }
}

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
  @UseFilters(MediaUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fieldSize: 512 * 1024,
        fileSize: MEDIA_MULTIPART_FILE_LIMIT,
        files: 1,
      },
    }),
  )
  localUpload(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LocalUploadDto,
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype?: string;
      originalname?: string;
      size: number;
    },
  ) {
    if (file) {
      return this.media.localMultipartUpload(currentUser, id, file);
    }
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
