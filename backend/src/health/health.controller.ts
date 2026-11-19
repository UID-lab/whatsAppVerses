import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { SenderStateRepository } from '../messaging/sender-state.repository';

/** Liveness/readiness for load balancers and uptime monitors. */
@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senderState: SenderStateRepository,
  ) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    const state = await this.senderState.find().catch(() => null);
    return { status: 'ok', database: 'up', whatsapp: state?.connection ?? 'unknown', time: new Date().toISOString() };
  }
}
