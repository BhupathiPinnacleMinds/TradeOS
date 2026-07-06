import { SetMetadata } from '@nestjs/common';
import type { BusinessRole } from '@tradieos/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: BusinessRole[]) =>
  SetMetadata(ROLES_KEY, roles);
