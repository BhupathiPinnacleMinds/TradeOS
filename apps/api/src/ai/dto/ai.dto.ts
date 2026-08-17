import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type {
  ToriActionDraft,
  ToriChatMessage,
  ToriContext,
} from '@tradieos/shared';

export class ToriChatDto {
  @IsString()
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsObject()
  context?: ToriContext;

  @IsOptional()
  @IsArray()
  recentMessages?: Array<Pick<ToriChatMessage, 'role' | 'content'>>;
}

export class ConfirmToriActionDto {
  @IsObject()
  draft!: ToriActionDraft;
}
