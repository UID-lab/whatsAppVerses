import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Subscriber, SubscriberStatus } from '@prisma/client';
import type { CountryCode } from 'libphonenumber-js';
import { randomBytes, randomInt } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { maskPhone, normalizePhone } from '../common/phone/phone.util';
import { localDate } from '../common/time/time.util';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { DeliveryWorkerService } from '../delivery/delivery-worker.service';
import { VersesService } from '../verses/verses.service';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { SubscriptionView } from './dto/subscription-view.dto';
import { SubscribersRepository } from './subscribers.repository';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_LENGTH = 6;

export const confirmMessage = (code: string) => `JOIN ${code}`;

@Injectable()
export class SubscribersService {
  private readonly logger = new Logger(SubscribersService.name);

  constructor(
    private readonly repo: SubscribersRepository,
    private readonly verses: VersesService,
    private readonly deliveries: DeliveryRepository,
    private readonly worker: DeliveryWorkerService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Registers (or re-registers) a number. One row per number, so duplicates are impossible:
   *  - new number            → created
   *  - PENDING / UNSUBSCRIBED → reset with a fresh code and tokens
   *  - ACTIVE                → 409
   * In whatsapp_confirm mode the subscriber stays PENDING until they message "JOIN <code>".
   */
  async subscribe(dto: CreateSubscriberDto): Promise<SubscriptionView> {
    const phone = normalizePhone(dto.phone, this.config.get('DEFAULT_PHONE_REGION') as CountryCode);
    if (!phone) throw new BadRequestException('Please enter a valid WhatsApp mobile number.');

    const existing = await this.repo.findByPhone(phone.e164);
    if (existing?.status === SubscriberStatus.ACTIVE) {
      throw new ConflictException(
        'This number is already subscribed. To switch verse type, reply STOP on WhatsApp and subscribe again.',
      );
    }

    const direct = this.config.get('OPT_IN_MODE') === 'direct';
    const now = new Date();
    const common = {
      verseType: dto.verseType,
      status: direct ? SubscriberStatus.ACTIVE : SubscriberStatus.PENDING,
      confirmCodeExpiresAt: direct ? null : new Date(now.getTime() + this.config.get('CONFIRM_CODE_TTL_HOURS') * 3600_000),
      manageToken: randomBytes(16).toString('hex'),
      optedInAt: direct ? now : null,
      optedOutAt: null,
      channelAddress: null,
      consecutiveFailures: 0,
    };

    const sub = await this.withUniqueCode(direct, async (confirmCode) => {
      if (!existing) {
        return this.repo.create({
          ...common,
          confirmCode,
          phoneE164: phone.e164,
          rotationOffset: await this.verses.randomOffset(dto.verseType),
        });
      }
      const typeChanged = existing.verseType !== dto.verseType;
      return this.repo.update(existing.id, {
        ...common,
        confirmCode,
        ...(typeChanged ? { rotationOffset: await this.verses.randomOffset(dto.verseType), progress: 0 } : {}),
      });
    });

    this.logger.log(`Subscription ${existing ? 'renewed' : 'created'} for ${maskPhone(sub.phoneE164)} (${sub.status})`);
    if (direct) await this.queueWelcome(sub.id);
    return this.toView(sub);
  }

  async getByToken(token: string): Promise<SubscriptionView> {
    return this.toView(await this.requireByToken(token));
  }

  async unsubscribeByToken(token: string): Promise<SubscriptionView> {
    const sub = await this.requireByToken(token);
    if (sub.status === SubscriberStatus.UNSUBSCRIBED) return this.toView(sub);
    return this.toView(await this.optOut(sub));
  }

  // ---- used by inbound WhatsApp commands ------------------------------------------------------

  async activate(sub: Subscriber, channelAddress: string): Promise<{ sub: Subscriber; welcomeQueued: boolean }> {
    const updated = await this.repo.update(sub.id, {
      status: SubscriberStatus.ACTIVE,
      channelAddress,
      confirmCode: null,
      confirmCodeExpiresAt: null,
      optedInAt: new Date(),
      optedOutAt: null,
      consecutiveFailures: 0,
    });
    return { sub: updated, welcomeQueued: await this.queueWelcome(updated.id) };
  }

  async optOut(sub: Subscriber): Promise<Subscriber> {
    this.logger.log(`Opt-out for ${maskPhone(sub.phoneE164)}`);
    return this.repo.update(sub.id, {
      status: SubscriberStatus.UNSUBSCRIBED,
      optedOutAt: new Date(),
      confirmCode: null,
      confirmCodeExpiresAt: null,
    });
  }

  async resume(sub: Subscriber, channelAddress: string): Promise<Subscriber> {
    return this.repo.update(sub.id, {
      status: SubscriberStatus.ACTIVE,
      channelAddress,
      optedInAt: new Date(),
      optedOutAt: null,
      consecutiveFailures: 0,
    });
  }

  // ---- helpers --------------------------------------------------------------------------------

  private async queueWelcome(subscriberId: number): Promise<boolean> {
    const queued = await this.deliveries.scheduleWelcome(subscriberId, localDate(this.config.get('APP_TIMEZONE')));
    if (queued) this.worker.wake();
    return queued;
  }

  private async requireByToken(token: string): Promise<Subscriber> {
    const sub = await this.repo.findByManageToken(token);
    if (!sub) throw new NotFoundException('Subscription not found.');
    return sub;
  }

  /** Retries on the (astronomically rare) confirm-code collision. */
  private async withUniqueCode(direct: boolean, write: (code: string | null) => Promise<Subscriber>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await write(direct ? null : this.generateCode());
      } catch (err) {
        const isUnique = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        const target = String((err as Prisma.PrismaClientKnownRequestError).meta?.target ?? '');
        if (isUnique && target.includes('phoneE164')) {
          throw new ConflictException('This number was just registered. Please try again.');
        }
        if (!isUnique || attempt >= 3) throw err;
      }
    }
  }

  private generateCode(): string {
    return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  }

  toView(sub: Subscriber): SubscriptionView {
    const pending = sub.status === SubscriberStatus.PENDING && sub.confirmCode && sub.confirmCodeExpiresAt;
    const text = sub.confirmCode ? confirmMessage(sub.confirmCode) : '';
    return {
      status: sub.status,
      verseType: sub.verseType,
      phone: maskPhone(sub.phoneE164),
      manageToken: sub.manageToken,
      confirmation: pending
        ? {
            code: sub.confirmCode!,
            message: text,
            whatsappUrl: `https://wa.me/${this.config.get('WA_PHONE_NUMBER')}?text=${encodeURIComponent(text)}`,
            expiresAt: sub.confirmCodeExpiresAt!.toISOString(),
          }
        : null,
    };
  }
}
