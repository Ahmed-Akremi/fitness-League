import type { Role } from '@prisma/client';

/** Judge-only accounts: created by admins, signed in to the admin panel judge space, never to the app. */
export const JUDGE_ROLES: Role[] = ['JUDGE', 'HEAD_JUDGE'];

/** The authenticated principal attached to `req.user` by the auth guard. */
export interface AuthUser {
  id: string;
  role: Role;
  emailVerified: boolean;
}
