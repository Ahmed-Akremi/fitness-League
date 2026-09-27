/**
 * Bootstrap the first staff account (nobody can grant themselves a role through the API).
 * Usage: pnpm promote-admin <email> [SUPER_ADMIN|ADMIN|MODERATOR]
 * The user must already be registered; 2FA is enrolled at their first admin-panel sign-in.
 */
import { existsSync } from 'node:fs';
import { PrismaClient, Role } from '@prisma/client';
import { uuidv7 } from '../src/common/ids/uuid';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const [email, roleArg = 'SUPER_ADMIN'] = process.argv.slice(2);
  const role = roleArg as Role;
  if (!email || !['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(role)) {
    console.error('Usage: pnpm promote-admin <email> [SUPER_ADMIN|ADMIN|MODERATOR]');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new Error(`No user with email ${email}: register in the app first.`);
    await prisma.user.update({ where: { id: user.id }, data: { role, sessionVersion: { increment: 1 } } });
    await prisma.auditLog.create({ data: { id: uuidv7(), action: 'USER_ROLE_CHANGED', entityType: 'user', entityId: user.id, before: { role: user.role }, after: { role, via: 'cli' } } });
    console.log(`${email} is now ${role}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
