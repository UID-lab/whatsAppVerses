import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../config/app-config.service';
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
  ) {}

  /** Static options the sign-up form needs. */
  @Get('options')
  options() {
    return {
      optInMode: this.config.get('OPT_IN_MODE'),
      defaultRegion: this.config.get('DEFAULT_PHONE_REGION'),
      sendTime: this.config.get('DAILY_SEND_TIME'),
      timezone: this.config.get('APP_TIMEZONE'),
      verseTypes: [
        { id: 'BIBLE', label: 'Bible verses', description: 'King James Version' },
        { id: 'GITA', label: 'Bhagavad Gita verses', description: 'Sanskrit with English translation' },
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
