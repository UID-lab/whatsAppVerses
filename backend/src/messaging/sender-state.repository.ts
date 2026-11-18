import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { ProviderStatus } from './messaging.types';

/** Persists the sender's connection status so every API replica can report it. */
@Injectable()
export class SenderStateRepository {
  private readonly logger = new Logger(SenderStateRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  private get id() {
    return this.config.get('WA_SESSION_ID');
  }

  async save(status: ProviderStatus): Promise<void> {
    const data = {
      connection: status.connection,
      qr: status.qr ?? null,
      meJid: status.account ?? null,
      lastError: status.lastError?.slice(0, 500) ?? null,
    };
    try {
      await this.prisma.senderState.upsert({ where: { id: this.id }, create: { id: this.id, ...data }, update: data });
    } catch (err) {
      this.logger.warn(`Could not persist sender state: ${(err as Error).message}`);
    }
  }

  find() {
    return this.prisma.senderState.findUnique({ where: { id: this.id } });
  }
}
