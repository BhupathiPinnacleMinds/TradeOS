import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '@tradieos/shared';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { AuthService } from './auth.service';
import { RateLimitPolicy } from '../rate-limit/rate-limit.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @RateLimitPolicy('auth')
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @RateLimitPolicy('auth')
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user);
  }

  @Public()
  @RateLimitPolicy('auth')
  @Get('demo-token')
  async demoToken() {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException(
        'Demo token endpoint is disabled in production',
      );
    }

    return this.auth.demoToken();
  }
}
