import {
  All,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { ConfirmToriActionDto, ToriChatDto } from './dto/ai.dto';

@Controller('ai/tori')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('summary')
  summary(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.ai.summary(currentUser);
  }

  @Post('chat')
  chat(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: ToriChatDto,
  ) {
    return this.ai.chat(currentUser, dto);
  }

  @Post('actions/:draftId/confirm')
  confirm(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('draftId') draftId: string,
    @Body() dto: ConfirmToriActionDto,
  ) {
    return this.ai.confirm(currentUser, draftId, dto.draft);
  }

  @All('*path')
  unsupported() {
    throw new HttpException(
      {
        code: 'TORI_ENDPOINT_NOT_FOUND',
        message: 'That Tori endpoint is not available.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
