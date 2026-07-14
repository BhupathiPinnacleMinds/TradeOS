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
import { CustomersService } from './customers.service';
import {
  ListCustomersQueryDto,
  UpsertCustomerDto,
  UpsertCustomerSiteDto,
} from './dto/customers.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListCustomersQueryDto,
  ) {
    return this.customers.findAll(currentUser, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.customers.findOne(currentUser, id);
  }

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpsertCustomerDto,
  ) {
    return this.customers.create(currentUser, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertCustomerDto,
  ) {
    return this.customers.update(currentUser, id, dto);
  }

  @Post(':id/archive')
  archive(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.customers.archive(currentUser, id);
  }

  @Post(':id/restore')
  restore(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.customers.restore(currentUser, id);
  }

  @Get(':id/sites')
  listSites(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.customers.listSites(currentUser, id);
  }

  @Post(':id/sites')
  createSite(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertCustomerSiteDto,
  ) {
    return this.customers.createSite(currentUser, id, dto);
  }

  @Patch(':id/sites/:siteId')
  updateSite(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Param('siteId') siteId: string,
    @Body() dto: UpsertCustomerSiteDto,
  ) {
    return this.customers.updateSite(currentUser, id, siteId, dto);
  }

  @Post(':id/sites/:siteId/archive')
  archiveSite(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Param('siteId') siteId: string,
  ) {
    return this.customers.archiveSite(currentUser, id, siteId);
  }
}
