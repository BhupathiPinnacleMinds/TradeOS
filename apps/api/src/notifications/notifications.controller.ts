import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListNotificationsQueryDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.findAll(currentUser, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.notifications.unreadCount(currentUser);
  }

  @Patch(':id/read')
  markRead(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(currentUser, id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.notifications.markAllRead(currentUser);
  }
}
