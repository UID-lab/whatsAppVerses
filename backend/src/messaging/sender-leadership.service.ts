import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LeaseService } from '../coordination/lease.service';
import { MESSAGING_PROVIDER, MessagingProvider } from './messaging.types';

type LeadershipListener = (isLeader: boolean) => Promise<void> | void;

const LEASE_TTL_SECONDS = 30;
const RENEW_EVERY_MS = 10_000;

/**
 * Guarantees exactly one process owns the WhatsApp session at a time.
 *
 * A WhatsApp linked device can only hold one live connection; two replicas connecting with the
 * same credentials would keep kicking each other off. Every sender-capable replica competes for
 * a DB lease; the winner starts the provider and the delivery worker, the others stand by and
 * take over automatically within ~30s if the leader dies.
 */
@Injectable()
export class SenderLeadershipService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SenderLeadershipService.name);
  private readonly listeners: LeadershipListener[] = [];
  private leader = false;
  private lastRenewedAt = 0;
  private timer?: NodeJS.Timeout;
  private transition: Promise<void> = Promise.resolve();

  constructor(
    private readonly lease: LeaseService,
    private readonly config: AppConfigService,
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
  ) {}

  get isLeader(): boolean {
    return this.leader;
  }

  private get leaseName(): string {
    return `whatsapp-sender:${this.config.get('WA_SESSION_ID')}`;
  }

  onLeadershipChange(listener: LeadershipListener): void {
    this.listeners.push(listener);
  }

  onApplicationBootstrap(): void {
    if (!this.config.runsSender) {
      this.logger.log('PROCESS_ROLE=api: this instance will not send WhatsApp messages');
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), RENEW_EVERY_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    if (this.leader) {
      await this.setLeader(false);
      await this.lease.release(this.leaseName);
    }
  }

  private async tick(): Promise<void> {
    try {
      const acquired = await this.lease.tryAcquire(this.leaseName, LEASE_TTL_SECONDS);
      if (acquired) this.lastRenewedAt = Date.now();
      if (acquired !== this.leader) await this.setLeader(acquired);
    } catch (err) {
      this.logger.warn(`Lease renewal failed: ${(err as Error).message}`);
      // Keep running through short DB blips, but step down before our lease could have expired.
      if (this.leader && Date.now() - this.lastRenewedAt > (LEASE_TTL_SECONDS - 5) * 1000) {
        await this.setLeader(false);
      }
    }
  }

  private setLeader(value: boolean): Promise<void> {
    this.transition = this.transition.then(async () => {
      if (this.leader === value) return;
      this.leader = value;
      this.logger.log(value ? 'Acquired sender lease — starting WhatsApp sender' : 'Lost sender lease — stopping sender');
      try {
        if (value) await this.provider.start();
        for (const l of this.listeners) await l(value);
        if (!value) await this.provider.stop();
      } catch (err) {
        this.logger.error(`Leadership transition failed: ${(err as Error).message}`);
      }
    });
    return this.transition;
  }
}
