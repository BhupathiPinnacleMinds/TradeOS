import {
  All,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { RateLimitPolicy } from '../rate-limit/rate-limit.decorator';
import { AiService } from './ai.service';
import { ConfirmToriActionDto, ToriChatDto } from './dto/ai.dto';

@Controller('ai/tori')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('summary')
  @RateLimitPolicy('toriChat')
  summary(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.ai.summary(currentUser);
  }

  @Post('chat')
  @RateLimitPolicy('toriChat')
  chat(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: ToriChatDto,
  ) {
    return this.ai.chat(currentUser, dto);
  }

  @Post('actions/:draftId/confirm')
  @RateLimitPolicy('toriAction')
  confirm(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('draftId') draftId: string,
    @Body() dto: ConfirmToriActionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey: idempotencyKey ?? draftId,
        operation: 'tori.action.confirm',
        request: { draft: dto.draft, draftId },
        userId: currentUser.id,
      },
      () => this.ai.confirm(currentUser, draftId, dto.draft),
    );
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
