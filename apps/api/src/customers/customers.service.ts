import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(businessId: string) {
    return this.prisma.customer.findMany({
      where: { businessId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }
}
