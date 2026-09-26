import type { Role } from '@prisma/client';

/** The authenticated principal attached to `req.user` by the auth guard. */
export interface AuthUser {
  id: string;
  role: Role;
  emailVerified: boolean;
}
