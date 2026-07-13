import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
