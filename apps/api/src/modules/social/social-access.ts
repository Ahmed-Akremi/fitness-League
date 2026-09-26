import { Injectable } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Visibility and block rules shared by every module that shows one user's content to another (docs §12). */
@Injectable()
export class SocialAccess {
  constructor(private readonly prisma: PrismaService) {}

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const n = await this.prisma.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
    return n > 0;
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const [low, high] = a < b ? [a, b] : [b, a];
    const f = await this.prisma.friendship.findUnique({ where: { userLowId_userHighId: { userLowId: low, userHighId: high } } });
    return f?.status === 'ACCEPTED';
  }

  async canView(viewerId: string, ownerId: string, visibility: Visibility): Promise<boolean> {
    if (viewerId === ownerId) return true;
    if (visibility === 'PRIVATE' || (await this.isBlockedEitherWay(viewerId, ownerId))) return false;
    return visibility === 'PUBLIC' || (await this.areFriends(viewerId, ownerId));
  }
}
