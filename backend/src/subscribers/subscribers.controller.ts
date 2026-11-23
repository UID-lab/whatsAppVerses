import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../config/app-config.service';
import { formatClockTime } from '../common/time/time.util';
import { SettingsService } from '../settings/settings.service';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { ManageTokenParams } from './dto/manage-token.dto';
import { SubscriptionView } from './dto/subscription-view.dto';
import { SubscribersService } from './subscribers.service';

@ApiTags('Subscribers (public)')
@Controller('subscribers')
export class SubscribersController {
  constructor(
    private readonly subscribers: SubscribersService,
    private readonly config: AppConfigService,
    private readonly settings: SettingsService,
  ) {}

  /** Options the sign-up form needs, including the live send time. */
  @Get('options')
  async options() {
    const schedule = await this.settings.schedule();
    return {
      optInMode: this.config.get('OPT_IN_MODE'),
      defaultRegion: this.config.get('DEFAULT_PHONE_REGION'),
      sendTime: schedule.dailySendTime,
      sendTimeLabel: formatClockTime(schedule.dailySendTime),
      timezone: this.config.get('APP_TIMEZONE'),
      verseTypes: [
        { id: 'BIBLE', label: 'Bible verses', description: 'King James Version' },
        { id: 'GITA', label: 'Bhagavad Gita verses', description: 'English translation' },
        { id: 'QURAN', label: 'Quran verses', description: 'Arabic with English translation (Pickthall)' },
      ],
    };
  }

  @Post()
  @ApiOperation({ summary: 'Subscribe a number (name, phone, verseType: BIBLE | GITA | QURAN)' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  subscribe(@Body() dto: CreateSubscriberDto): Promise<SubscriptionView> {
    return this.subscribers.subscribe(dto);
  }

  @Get('manage/:token')
  get(@Param() { token }: ManageTokenParams): Promise<SubscriptionView> {
    return this.subscribers.getByToken(token);
  }

  @Post('manage/:token/unsubscribe')
  @HttpCode(HttpStatus.OK)
  unsubscribe(@Param() { token }: ManageTokenParams): Promise<SubscriptionView> {
    return this.subscribers.unsubscribeByToken(token);
  }
}
