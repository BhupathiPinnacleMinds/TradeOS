import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuthenticatedUser,
  AustralianState,
  ContactPreference,
  Customer,
  CustomerDetailResponse,
  CustomerDuplicateMatch,
  CustomerListResponse,
  CustomerSite,
  CustomerSummary,
  CustomerType,
} from '@tradieos/shared';
import {
  AUSTRALIAN_STATES,
  CUSTOMER_ARCHIVE_ROLES,
  CUSTOMER_VIEW_ROLES,
  CUSTOMER_WRITE_ROLES,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type {
  ListCustomersQueryDto,
  UpsertCustomerDto,
  UpsertCustomerSiteDto,
} from './dto/customers.dto';

type CustomerWithSites = {
  id: string;
  businessId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  contactPreference: ContactPreference;
  customerType: CustomerType;
  notes: string | null;
  tags: string[];
  isArchived: boolean;
  archivedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  sites?: CustomerSiteRecord[];
};

type CustomerSiteRecord = {
  id: string;
  businessId: string;
  customerId: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  accessInstructions: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  isPrimary: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const READ_ONLY_ROLES = ['ACCOUNTANT', 'READ_ONLY'] as const;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListCustomersQueryDto,
  ): Promise<CustomerListResponse> {
    this.assertRole(currentUser, CUSTOMER_VIEW_ROLES);

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      100,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const where = this.buildWhere(currentUser.businessId, query);
    const orderBy = this.orderBy(query.sortBy, query.sortOrder);

    const [records, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sites: {
            where: { isArchived: false },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      records: records.map((customer) => this.toCustomer(customer)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findOne(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<CustomerDetailResponse> {
    this.assertRole(currentUser, CUSTOMER_VIEW_ROLES);
    const customer = await this.getCustomer(currentUser.businessId, id);
    const activity = await this.prisma.auditLog.findMany({
      where: {
        businessId: currentUser.businessId,
        entityType: { in: ['Customer', 'CustomerSite'] },
        OR: [
          { entityId: customer.id },
          { metadata: { path: ['customerId'], equals: customer.id } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return {
      activity: activity.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      })),
      customer: this.toCustomer(customer),
      summary: this.summary(customer),
    };
  }

  async create(
    currentUser: AuthenticatedUser,
    dto: UpsertCustomerDto,
  ): Promise<CustomerDetailResponse> {
    this.assertRole(currentUser, CUSTOMER_WRITE_ROLES);
    const data = this.normaliseCustomer(dto);
    const duplicates = await this.findDuplicates(
      currentUser.businessId,
      data.emailNormalised,
      data.phoneNormalised,
    );

    if (duplicates.length && !dto.allowDuplicate) {
      throw this.duplicateWarning(duplicates);
    }

    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          ...data,
          businessId: currentUser.businessId,
          createdBy: currentUser.id,
          status: 'ACTIVE',
        },
        include: { sites: true },
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action:
            dto.allowDuplicate && duplicates.length
              ? 'DUPLICATE_WARNING_OVERRIDDEN'
              : 'CUSTOMER_CREATED',
          entityType: 'Customer',
          entityId: created.id,
          metadata: {
            duplicateMatchIds: duplicates.map((match) => match.id),
            fields: Object.keys(data),
          },
        },
      });

      return created;
    });

    return this.findOne(currentUser, customer.id);
  }

  async update(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpsertCustomerDto,
  ): Promise<CustomerDetailResponse> {
    this.assertRole(currentUser, CUSTOMER_WRITE_ROLES);
    const existing = await this.getCustomer(currentUser.businessId, id);
    const data = this.normaliseCustomer(dto);
    const duplicates = await this.findDuplicates(
      currentUser.businessId,
      data.emailNormalised,
      data.phoneNormalised,
      id,
    );

    if (duplicates.length && !dto.allowDuplicate) {
      throw this.duplicateWarning(duplicates);
    }

    const changedFields = Object.entries(data)
      .filter(
        ([key, value]) =>
          JSON.stringify(existing[key as keyof CustomerWithSites]) !==
          JSON.stringify(value),
      )
      .map(([key]) => key);

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { ...data, updatedBy: currentUser.id },
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action:
            dto.allowDuplicate && duplicates.length
              ? 'DUPLICATE_WARNING_OVERRIDDEN'
              : 'CUSTOMER_UPDATED',
          entityType: 'Customer',
          entityId: id,
          metadata: {
            changedFields,
            duplicateMatchIds: duplicates.map((match) => match.id),
          },
        },
      });
    });

    return this.findOne(currentUser, id);
  }

  async archive(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<CustomerDetailResponse> {
    this.assertRole(currentUser, CUSTOMER_ARCHIVE_ROLES);
    const customer = await this.getCustomer(currentUser.businessId, id);
    if (customer.isArchived) {
      throw this.domainError(
        HttpStatus.CONFLICT,
        'CUSTOMER_ALREADY_ARCHIVED',
        'This customer is already archived.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          isArchived: true,
          status: 'ARCHIVED',
          updatedBy: currentUser.id,
        },
      });
      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'CUSTOMER_ARCHIVED',
          entityType: 'Customer',
          entityId: id,
          metadata: { displayName: customer.displayName },
        },
      });
    });

    return this.findOne(currentUser, id);
  }

  async restore(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<CustomerDetailResponse> {
    this.assertRole(currentUser, CUSTOMER_ARCHIVE_ROLES);
    const customer = await this.getCustomer(currentUser.businessId, id);
    if (!customer.isArchived) {
      throw this.domainError(
        HttpStatus.CONFLICT,
        'CUSTOMER_NOT_ARCHIVED',
        'This customer is not archived.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          archivedAt: null,
          isArchived: false,
          status: 'ACTIVE',
          updatedBy: currentUser.id,
        },
      });
      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'CUSTOMER_RESTORED',
          entityType: 'Customer',
          entityId: id,
          metadata: { displayName: customer.displayName },
        },
      });
    });

    return this.findOne(currentUser, id);
  }

  async listSites(currentUser: AuthenticatedUser, customerId: string) {
    this.assertRole(currentUser, CUSTOMER_VIEW_ROLES);
    await this.getCustomer(currentUser.businessId, customerId);
    const sites = await this.prisma.customerSite.findMany({
      where: {
        businessId: currentUser.businessId,
        customerId,
        isArchived: false,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return sites.map((site) => this.toSite(site));
  }

  async createSite(
    currentUser: AuthenticatedUser,
    customerId: string,
    dto: UpsertCustomerSiteDto,
  ) {
    this.assertRole(currentUser, CUSTOMER_WRITE_ROLES);
    await this.getCustomer(currentUser.businessId, customerId);
    const data = this.normaliseSite(dto);

    const site = await this.prisma.$transaction(async (tx) => {
      if (data.isPrimary) {
        await tx.customerSite.updateMany({
          where: { businessId: currentUser.businessId, customerId },
          data: { isPrimary: false },
        });
      }

      const created = await tx.customerSite.create({
        data: {
          ...data,
          businessId: currentUser.businessId,
          customerId,
        },
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'CUSTOMER_SITE_CREATED',
          entityType: 'CustomerSite',
          entityId: created.id,
          metadata: { customerId, fields: Object.keys(data) },
        },
      });

      return created;
    });

    return this.toSite(site);
  }

  async updateSite(
    currentUser: AuthenticatedUser,
    customerId: string,
    siteId: string,
    dto: UpsertCustomerSiteDto,
  ) {
    this.assertRole(currentUser, CUSTOMER_WRITE_ROLES);
    const existing = await this.getSite(
      currentUser.businessId,
      customerId,
      siteId,
    );
    const data = this.normaliseSite(dto);
    const changedFields = Object.entries(data)
      .filter(
        ([key, value]) =>
          JSON.stringify(existing[key as keyof CustomerSiteRecord]) !==
          JSON.stringify(value),
      )
      .map(([key]) => key);

    const site = await this.prisma.$transaction(async (tx) => {
      if (data.isPrimary) {
        await tx.customerSite.updateMany({
          where: { businessId: currentUser.businessId, customerId },
          data: { isPrimary: false },
        });
      }

      const updated = await tx.customerSite.update({
        where: { id: siteId },
        data,
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'CUSTOMER_SITE_UPDATED',
          entityType: 'CustomerSite',
          entityId: siteId,
          metadata: { changedFields, customerId },
        },
      });

      return updated;
    });

    return this.toSite(site);
  }

  async archiveSite(
    currentUser: AuthenticatedUser,
    customerId: string,
    siteId: string,
  ) {
    this.assertRole(currentUser, CUSTOMER_ARCHIVE_ROLES);
    await this.getSite(currentUser.businessId, customerId, siteId);

    const site = await this.prisma.$transaction(async (tx) => {
      const archived = await tx.customerSite.update({
        where: { id: siteId },
        data: { isArchived: true, isPrimary: false },
      });

      await tx.auditLog.create({
        data: {
          businessId: currentUser.businessId,
          actorUserId: currentUser.id,
          action: 'CUSTOMER_SITE_ARCHIVED',
          entityType: 'CustomerSite',
          entityId: siteId,
          metadata: { customerId },
        },
      });

      return archived;
    });

    return this.toSite(site);
  }

  private buildWhere(
    businessId: string,
    query: ListCustomersQueryDto,
  ): Prisma.CustomerWhereInput {
    const archived = query.archived === 'true';
    const where: Prisma.CustomerWhereInput = {
      businessId,
      isArchived: archived,
    };

    if (query.customerType) where.customerType = query.customerType;
    if (query.state) where.state = query.state;
    if (query.suburb) {
      where.suburb = { contains: query.suburb.trim(), mode: 'insensitive' };
    }
    if (query.tag) where.tags = { has: this.cleanTag(query.tag) };
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { suburb: { contains: search, mode: 'insensitive' } },
        { postcode: { contains: search, mode: 'insensitive' } },
        { tags: { has: this.cleanTag(search) } },
      ];
    }

    return where;
  }

  private orderBy(
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'asc',
  ): Prisma.CustomerOrderByWithRelationInput[] {
    const direction: 'asc' | 'desc' = sortOrder === 'desc' ? 'desc' : 'asc';
    if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
      return [{ [sortBy]: direction }];
    }
    if (sortBy === 'suburb' || sortBy === 'customerType') {
      return [{ [sortBy]: direction }, { displayName: 'asc' as const }];
    }
    return [{ displayName: direction }];
  }

  private normaliseCustomer(dto: UpsertCustomerDto) {
    const firstName = this.optional(dto.firstName);
    const lastName = this.optional(dto.lastName);
    const companyName = this.optional(dto.companyName);
    const email = this.optional(dto.email)?.toLowerCase() ?? null;
    const phone = this.optional(dto.phone);
    const alternatePhone = this.optional(dto.alternatePhone);
    const state = this.optional(dto.state) as AustralianState | null;
    const postcode = this.optional(dto.postcode);

    if (!firstName && !companyName) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CUSTOMER_DATA',
        'Enter a first name or company name.',
      );
    }
    if (!email && !phone) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CUSTOMER_DATA',
        'Enter at least one contact method.',
      );
    }
    if (phone && !this.isAustralianPhone(phone)) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CUSTOMER_DATA',
        'Enter a valid Australian phone number.',
      );
    }
    if (alternatePhone && !this.isAustralianPhone(alternatePhone)) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CUSTOMER_DATA',
        'Enter a valid Australian alternate phone number.',
      );
    }
    if (postcode && !/^\d{4}$/.test(postcode)) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CUSTOMER_DATA',
        'Postcode must be exactly 4 digits.',
      );
    }
    if (state && !AUSTRALIAN_STATES.includes(state)) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CUSTOMER_DATA',
        'Choose a valid Australian state or territory.',
      );
    }

    return {
      addressLine1: this.optional(dto.addressLine1),
      addressLine2: this.optional(dto.addressLine2),
      alternatePhone,
      companyName,
      contactPreference: dto.contactPreference,
      customerType: dto.customerType,
      displayName: this.displayName(firstName, lastName, companyName),
      email,
      emailNormalised: email,
      firstName,
      lastName,
      notes: this.optional(dto.notes),
      phone,
      phoneNormalised: phone ? this.normalisePhone(phone) : null,
      postcode,
      state,
      suburb: this.optional(dto.suburb),
      tags: this.cleanTags(dto.tags ?? []),
    };
  }

  private normaliseSite(dto: UpsertCustomerSiteDto) {
    if (!this.isAustralianPhone(dto.siteContactPhone ?? '0400 000 000')) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CUSTOMER_DATA',
        'Enter a valid Australian site contact phone number.',
      );
    }

    return {
      accessInstructions: this.optional(dto.accessInstructions),
      addressLine1: dto.addressLine1.trim(),
      addressLine2: this.optional(dto.addressLine2),
      isPrimary: Boolean(dto.isPrimary),
      label: dto.label.trim(),
      postcode: dto.postcode.trim(),
      siteContactName: this.optional(dto.siteContactName),
      siteContactPhone: this.optional(dto.siteContactPhone),
      state: dto.state,
      suburb: dto.suburb.trim(),
    };
  }

  private async findDuplicates(
    businessId: string,
    emailNormalised: string | null,
    phoneNormalised: string | null,
    excludeId?: string,
  ): Promise<CustomerDuplicateMatch[]> {
    if (!emailNormalised && !phoneNormalised) return [];
    const OR: Array<{ emailNormalised?: string; phoneNormalised?: string }> =
      [];
    if (emailNormalised) OR.push({ emailNormalised });
    if (phoneNormalised) OR.push({ phoneNormalised });

    const matches = await this.prisma.customer.findMany({
      where: {
        businessId,
        id: excludeId ? { not: excludeId } : undefined,
        OR,
      },
      select: {
        displayName: true,
        email: true,
        id: true,
        phone: true,
      },
      take: 5,
    });

    return matches;
  }

  private async getCustomer(businessId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { businessId, id },
      include: {
        sites: {
          where: { isArchived: false },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!customer) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'CUSTOMER_NOT_FOUND',
        'Customer not found.',
      );
    }

    return customer;
  }

  private async getSite(
    businessId: string,
    customerId: string,
    siteId: string,
  ) {
    const site = await this.prisma.customerSite.findFirst({
      where: { businessId, customerId, id: siteId },
    });
    if (!site) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'CUSTOMER_NOT_FOUND',
        'Customer site not found.',
      );
    }
    return site;
  }

  private summary(customer: CustomerWithSites): CustomerSummary {
    const primarySite = customer.sites?.find((site) => site.isPrimary);
    return {
      contactPreferenceLabel: customer.contactPreference.replaceAll('_', ' '),
      customerSince: customer.createdAt.toISOString(),
      customerTypeLabel: customer.customerType.replaceAll('_', ' '),
      primarySuburb: primarySite?.suburb ?? customer.suburb,
      serviceLocationCount: customer.sites?.length ?? 0,
    };
  }

  private toCustomer(customer: CustomerWithSites): Customer {
    return {
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      alternatePhone: customer.alternatePhone,
      archivedAt: customer.archivedAt?.toISOString() ?? null,
      businessId: customer.businessId,
      companyName: customer.companyName,
      contactPreference: customer.contactPreference,
      createdAt: customer.createdAt.toISOString(),
      createdBy: customer.createdBy,
      customerType: customer.customerType,
      displayName: customer.displayName,
      email: customer.email,
      firstName: customer.firstName,
      id: customer.id,
      isArchived: customer.isArchived,
      lastName: customer.lastName,
      notes: customer.notes,
      phone: customer.phone,
      postcode: customer.postcode,
      sites: (customer.sites ?? []).map((site) => this.toSite(site)),
      state: customer.state as AustralianState | null,
      suburb: customer.suburb,
      tags: customer.tags,
      updatedAt: customer.updatedAt.toISOString(),
      updatedBy: customer.updatedBy,
    };
  }

  private toSite(site: CustomerSiteRecord): CustomerSite {
    return {
      accessInstructions: site.accessInstructions,
      addressLine1: site.addressLine1,
      addressLine2: site.addressLine2,
      businessId: site.businessId,
      createdAt: site.createdAt.toISOString(),
      customerId: site.customerId,
      id: site.id,
      isArchived: site.isArchived,
      isPrimary: site.isPrimary,
      label: site.label,
      postcode: site.postcode,
      siteContactName: site.siteContactName,
      siteContactPhone: site.siteContactPhone,
      state: site.state as AustralianState,
      suburb: site.suburb,
      updatedAt: site.updatedAt.toISOString(),
    };
  }

  private assertRole(
    currentUser: AuthenticatedUser,
    allowedRoles: readonly string[],
  ) {
    if (!allowedRoles.includes(currentUser.role)) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'You do not have permission to perform this customer action.',
      );
    }
    if (
      READ_ONLY_ROLES.includes(currentUser.role as never) &&
      allowedRoles !== CUSTOMER_VIEW_ROLES
    ) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'You do not have permission to edit customers.',
      );
    }
  }

  private duplicateWarning(matches: CustomerDuplicateMatch[]) {
    return this.domainError(
      HttpStatus.CONFLICT,
      'POSSIBLE_DUPLICATE_CUSTOMER',
      'A customer with this phone number or email may already exist.',
      { matches },
    );
  }

  private domainError(
    status: HttpStatus,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    return new HttpException({ code, message, details }, status);
  }

  private displayName(
    firstName: string | null,
    lastName: string | null,
    companyName: string | null,
  ) {
    const person = [firstName, lastName].filter(Boolean).join(' ').trim();
    return person || companyName || 'Customer';
  }

  private optional(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private cleanTag(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  }

  private cleanTags(tags: string[]) {
    return Array.from(
      new Set(tags.map((tag) => this.cleanTag(tag)).filter(Boolean)),
    ).slice(0, 12);
  }

  private normalisePhone(value: string) {
    const trimmed = value.trim();
    if (trimmed.startsWith('+')) {
      return `+${trimmed.slice(1).replace(/\D/g, '')}`;
    }
    return trimmed.replace(/\D/g, '');
  }

  private isAustralianPhone(value: string) {
    const normalised = this.normalisePhone(value);
    return (
      /^(\+614|04)\d{8}$/.test(normalised) ||
      /^(\+61[2378]|0[2378])\d{8}$/.test(normalised)
    );
  }
}
