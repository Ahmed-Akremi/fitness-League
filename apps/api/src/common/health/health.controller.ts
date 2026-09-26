import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { AppException, ErrorCode } from '../errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. */
  @Get('health')
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies answer. Used by the load balancer before routing traffic. */
  @Get('ready')
  @ApiOkResponse({ schema: { example: { status: 'ready', checks: { database: 'up' } } } })
  async ready(): Promise<{ status: 'ready'; checks: Record<string, 'up'> }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.INTERNAL, 'Not ready', { extra: { checks: { database: 'down' } } });
    }
    return { status: 'ready', checks: { database: 'up' } };
  }
}
