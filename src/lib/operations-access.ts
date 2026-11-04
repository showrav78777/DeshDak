import { ROLE } from "@/lib/roles";

export function hasOperationsAccess(roles: string[], required: string) {
  return roles.includes(ROLE.ADMIN) || roles.includes(required);
}
