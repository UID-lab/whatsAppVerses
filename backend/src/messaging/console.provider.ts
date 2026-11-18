import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  InboundHandler,
  MessagingProvider,
  ProviderStatus,
  Recipient,
  SendResult,
} from './messaging.types';

/**
 * Dry-run provider for local development and tests: logs messages instead of sending them.
 * `simulateInbound()` lets tests (or the admin API in development) fake a user's reply.
 */
export class ConsoleMessagingProvider implements MessagingProvider {
  readonly name = 'console';
  private readonly logger = new Logger('ConsoleProvider');
  private started = false;
  private handlers: InboundHandler[] = [];

  async start(): Promise<void> {
    this.started = true;
    this.logger.log('Console provider started (messages are logged, not sent)');
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  isReady(): boolean {
    return this.started;
  }

  status(): ProviderStatus {
    return { provider: this.name, connection: this.started ? 'open' : 'stopped', account: 'console' };
  }

  async sendText(to: Recipient, text: string): Promise<SendResult> {
    this.logger.log(`→ ${to.channelAddress ?? to.phoneE164}\n${text}`);
    return { providerMessageId: randomUUID() };
  }

  onInbound(handler: InboundHandler): void {
    this.handlers.push(handler);
  }

  async simulateInbound(phoneE164: string, text: string): Promise<void> {
    for (const h of this.handlers) {
      await h({
        channelAddress: `${phoneE164.slice(1)}@s.whatsapp.net`,
        phoneE164,
        text,
        providerMessageId: randomUUID(),
        receivedAt: new Date(),
      });
    }
  }
}
