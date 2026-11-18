import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { VerseType } from '@prisma/client';
import QRCode from 'qrcode';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { normalizePhone } from '../common/phone/phone.util';
import { localDate, toIsoDate } from '../common/time/time.util';
import { AppConfigService } from '../config/app-config.service';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { DeliverySchedulerService } from '../delivery/delivery-scheduler.service';
import { ConsoleMessagingProvider } from '../messaging/console.provider';
import { MESSAGING_PROVIDER, MessagingProvider } from '../messaging/messaging.types';
import { OutboundService } from '../messaging/outbound.service';
import { SenderLeadershipService } from '../messaging/sender-leadership.service';
import { SenderStateRepository } from '../messaging/sender-state.repository';
import { SubscribersRepository } from '../subscribers/subscribers.repository';
import { VersesService } from '../verses/verses.service';
import { PairingCodeDto, SimulateInboundDto } from './admin.dto';

/** Operator endpoints (WhatsApp linking, stats). Requires the `x-admin-key` header. */
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
@SkipThrottle()
export class AdminController {
  constructor(
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
    private readonly senderState: SenderStateRepository,
    private readonly leadership: SenderLeadershipService,
    private readonly outbound: OutboundService,
    private readonly scheduler: DeliverySchedulerService,
    private readonly deliveries: DeliveryRepository,
    private readonly subscribers: SubscribersRepository,
    private readonly verses: VersesService,
    private readonly config: AppConfigService,
  ) {}

  /** Connection state as last written by the sender (works from any replica), with a QR image. */
  @Get('whatsapp')
  async whatsapp() {
    const state = await this.senderState.find();
    return {
      provider: this.config.get('MESSAGING_PROVIDER'),
      phoneNumber: this.config.get('WA_PHONE_NUMBER'),
      connection: state?.connection ?? 'stopped',
      account: state?.meJid ?? null,
      lastError: state?.lastError ?? null,
      updatedAt: state?.updatedAt ?? null,
      qrDataUrl: state?.qr ? await QRCode.toDataURL(state.qr, { margin: 1, width: 320 }) : null,
      senderOnThisInstance: this.leadership.isLeader,
    };
  }

  /** Link by entering an 8-character code in WhatsApp instead of scanning a QR. */
  @Post('whatsapp/pairing-code')
  @HttpCode(HttpStatus.OK)
  async pairingCode(@Body() dto: PairingCodeDto) {
    this.requireSenderHere();
    if (!this.provider.requestPairingCode) throw new ConflictException('This provider does not support pairing codes');
    try {
      const code = await this.provider.requestPairingCode(dto.phone ?? this.config.get('WA_PHONE_NUMBER'));
      return { code };
    } catch (err) {
      throw new ConflictException((err as Error).message);
    }
  }

  @Post('whatsapp/logout')
  @HttpCode(HttpStatus.OK)
  async logout() {
    this.requireSenderHere();
    await this.provider.logout?.();
    return { ok: true };
  }

  @Get('stats')
  async stats() {
    const today = localDate(this.config.get('APP_TIMEZONE'));
    const [subscribers, deliveriesToday, sentToday, bible, gita, repeatedVerses] = await Promise.all([
      this.subscribers.countsByStatusAndType(),
      this.deliveries.statusCounts(today),
      this.outbound.sentToday(),
      this.verses.poolSize(VerseType.BIBLE),
      this.verses.poolSize(VerseType.GITA),
      this.verses.countRepeatedDeliveries(),
    ]);
    return {
      date: toIsoDate(today),
      subscribers,
      deliveriesToday,
      sentToday,
      dailySendCap: this.config.get('DAILY_SEND_CAP'),
      messagesPerMinute: this.config.get('MESSAGES_PER_MINUTE'),
      rotationPool: { BIBLE: bible, GITA: gita },
      /** Subscriber+verse pairs delivered more than once (within the retention window). Always 0. */
      repeatedVerses,
    };
  }

  /** Enqueue today's deliveries now (idempotent — safe to call repeatedly). */
  @Post('jobs/enqueue-today')
  @HttpCode(HttpStatus.OK)
  async enqueueToday() {
    const enqueued = await this.scheduler.enqueueFor(localDate(this.config.get('APP_TIMEZONE')));
    return { enqueued };
  }

  /** Development only: pretend a user sent us a WhatsApp message (console provider). */
  @Post('dev/simulate-inbound')
  @HttpCode(HttpStatus.OK)
  async simulateInbound(@Body() dto: SimulateInboundDto) {
    if (!(this.provider instanceof ConsoleMessagingProvider)) {
      throw new ConflictException('Only available with MESSAGING_PROVIDER=console');
    }
    const phone = normalizePhone(dto.phone, 'IN');
    if (!phone) throw new ConflictException('Invalid phone');
    await this.provider.simulateInbound(phone.e164, dto.text);
    return { ok: true };
  }

  private requireSenderHere(): void {
    if (!this.leadership.isLeader) {
      throw new ConflictException('The WhatsApp sender is not running on this instance (see PROCESS_ROLE / lease).');
    }
  }
}
