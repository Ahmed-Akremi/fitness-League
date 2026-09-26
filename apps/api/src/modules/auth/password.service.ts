import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** Argon2id with OWASP minimum parameters (m = 19 MiB, t = 2, p = 1), docs §9.1. */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Verified when the account doesn't exist, so response time doesn't reveal which emails are registered. */
  private readonly dummyHash = argon2.hash('fitness-league-timing-equaliser', OPTIONS);

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? (await this.dummyHash), password);
    } catch {
      return false;
    }
  }
}
