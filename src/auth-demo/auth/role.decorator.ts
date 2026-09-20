import { SetMetadata } from "@nestjs/common";
import { ROLES } from "../users/roles.type";

export const ROLE_KEY = 'ROLES'

export const Roles = (...allowedRoles: ROLES[]) => SetMetadata(ROLE_KEY, allowedRoles)