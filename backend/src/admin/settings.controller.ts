import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsOptional, Matches } from 'class-validator';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { formatClockTime, localDate, localMinutesNow, minutesOfDay } from '../common/time/time.util';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { Schedule, SettingsService } from '../settings/settings.service';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HH_MM_MSG = 'must be HH:MM (24-hour), e.g. 21:30';

export class UpdateScheduleDto {
  @ApiPropertyOptional({ example: '21:30', description: 'When daily verses go out (24-hour, local time)' })
  @IsOptional() @Matches(HH_MM, { message: `dailySendTime ${HH_MM_MSG}` })
  dailySendTime?: string;

  @ApiPropertyOptional({ example: '07:00', description: 'Daily verses are never sent before this' })
  @IsOptional() @Matches(HH_MM, { message: `sendWindowStart ${HH_MM_MSG}` })
  sendWindowStart?: string;

  @ApiPropertyOptional({ example: '23:00', description: 'Daily verses are never sent after this' })
  @IsOptional() @Matches(HH_MM, { message: `sendWindowEnd ${HH_MM_MSG}` })
  sendWindowEnd?: string;
}

export class ScheduleDto {
  @ApiProperty({ example: '21:30' }) dailySendTime: string;
  @ApiProperty({ example: '9:30 PM' }) dailySendTimeLabel: string;
  @ApiProperty({ example: '07:00' }) sendWindowStart: string;
  @ApiProperty({ example: '23:00' }) sendWindowEnd: string;
  @ApiProperty({ example: 'Asia/Kolkata' }) timezone: string;
  @ApiProperty({ enum: ['database', 'env'], description: '"database" = set here at runtime; "env" = from backend/.env' })
  source: 'database' | 'env';
  @ApiProperty({ description: "Whether today's daily run has already happened" }) todaysRunDone: boolean;
  @ApiProperty({ example: 'Today’s verses go out at 9:30 PM.' }) nextRun: string;
}

/**
 * Change the daily send time without editing .env or restarting. The scheduler, the welcome
 * message ("…your first verse will arrive today at 9:30 PM") and the sign-up page all pick up
 * the new time within a few seconds.
 */
@ApiTags('Admin: settings')
@ApiSecurity('admin-key')
@Controller('admin/settings')
@UseGuards(AdminApiKeyGuard)
@SkipThrottle()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly deliveries: DeliveryRepository,
  ) {}

  @Get('schedule')
  @ApiOperation({ summary: 'Current daily send time and window' })
  @ApiOkResponse({ type: ScheduleDto })
  async get(): Promise<ScheduleDto> {
    return this.describe(await this.settings.schedule());
  }

  @Put('schedule')
  @ApiOperation({
    summary: 'Change the daily send time (no restart needed)',
    description:
      'Takes effect within seconds for the scheduler, welcome messages and the sign-up page. ' +
      'Each subscriber still gets one verse per day: if today’s run already happened, the new time applies from tomorrow.',
  })
  @ApiOkResponse({ type: ScheduleDto })
  async update(@Body() dto: UpdateScheduleDto): Promise<ScheduleDto> {
    return this.describe(await this.settings.updateSchedule(dto));
  }

  @Delete('schedule')
  @ApiOperation({ summary: 'Go back to the times in backend/.env' })
  @ApiOkResponse({ type: ScheduleDto })
  async reset(): Promise<ScheduleDto> {
    return this.describe(await this.settings.resetSchedule());
  }

  private async describe(s: Schedule): Promise<ScheduleDto> {
    const label = formatClockTime(s.dailySendTime);
    const todaysRunDone = await this.deliveries.hasJobRun('daily-enqueue', localDate(s.timezone));
    const due = localMinutesNow(s.timezone) >= minutesOfDay(s.dailySendTime);
    const nextRun = todaysRunDone
      ? `Today’s verses have already gone out; next run tomorrow at ${label}.`
      : due
        ? `The send time has passed and today’s run hasn’t happened yet: it starts within a minute.`
        : `Today’s verses go out at ${label}.`;
    return { ...s, dailySendTimeLabel: label, todaysRunDone, nextRun };
  }
}
