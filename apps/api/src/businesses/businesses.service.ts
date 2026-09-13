import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AuthenticatedUser,
  BusinessPaymentInstructionsResponse,
  InvoicePaymentInstructions,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBusinessPaymentInstructionsDto } from './dto/businesses.dto';

const BUSINESS_SETTINGS_ROLES: readonly string[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
];

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async paymentInstructions(
    currentUser: AuthenticatedUser,
  ): Promise<BusinessPaymentInstructionsResponse> {
    this.assertSettingsRole(currentUser);
    const business = await this.getBusiness(currentUser.businessId);
    return { paymentInstructions: this.toPaymentInstructions(business) };
  }

  async updatePaymentInstructions(
    currentUser: AuthenticatedUser,
    dto: UpdateBusinessPaymentInstructionsDto,
  ): Promise<BusinessPaymentInstructionsResponse> {
    this.assertSettingsRole(currentUser);
    const business = await this.prisma.business.update({
      where: { id: currentUser.businessId },
      data: {
        paymentAccountName: this.clean(dto.accountName),
        paymentAccountNumber: this.clean(dto.accountNumber),
        paymentBankName: this.clean(dto.bankName),
        paymentBsb: this.clean(dto.bsb),
        paymentInstructions: this.clean(dto.customInstructions),
        paymentReferenceInstructions: this.clean(dto.referenceInstructions),
      },
      select: businessSelect,
    });
    return { paymentInstructions: this.toPaymentInstructions(business) };
  }

  private assertSettingsRole(currentUser: AuthenticatedUser) {
    if (!BUSINESS_SETTINGS_ROLES.includes(currentUser.role)) {
      throw new ForbiddenException('Insufficient workspace permissions');
    }
  }

  private async getBusiness(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: businessSelect,
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  private clean(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private toPaymentInstructions(
    business: Awaited<ReturnType<BusinessesService['getBusiness']>>,
  ): InvoicePaymentInstructions {
    const accountName = business.paymentAccountName?.trim() || null;
    const bankName = business.paymentBankName?.trim() || null;
    const bsb = business.paymentBsb?.trim() || null;
    const accountNumber = business.paymentAccountNumber?.trim() || null;
    return {
      accountName,
      accountNumber,
      bankName,
      bsb,
      customInstructions: business.paymentInstructions?.trim() || null,
      hasBankDetails: Boolean(accountName && bsb && accountNumber),
      reference:
        business.paymentReferenceInstructions?.trim() || 'Invoice number',
    };
  }
}

const businessSelect = {
  paymentAccountName: true,
  paymentAccountNumber: true,
  paymentBankName: true,
  paymentBsb: true,
  paymentInstructions: true,
  paymentReferenceInstructions: true,
} as const;
