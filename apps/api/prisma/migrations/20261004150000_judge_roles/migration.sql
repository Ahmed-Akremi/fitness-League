-- Judge-only accounts (admin panel judge space, no app access).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'JUDGE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HEAD_JUDGE';
