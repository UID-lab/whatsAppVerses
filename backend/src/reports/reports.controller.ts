import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { ActiveSubscribersQuery, DateQuery, DeliveriesQuery, RetryFailedQuery } from './dto/report-query.dto';
import {
  ActiveSubscribersDto,
  DeliveryDto,
  DeliveryListDto,
  DeliveryReportDto,
  RepeatReportDto,
  RequeueResultDto,
  SummaryDto,
} from './dto/report-responses.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiSecurity('admin-key')
@ApiUnauthorizedResponse({ description: 'Missing or wrong x-admin-key header' })
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
@SkipThrottle()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/summary')
  @ApiOperation({
    summary: 'Everything at a glance',
    description: 'Active subscribers, today’s delivered / failed / pending counts, the repeat check and verses stored in MySQL.',
  })
  @ApiOkResponse({ type: SummaryDto })
  summary(@Query() q: DateQuery): Promise<SummaryDto> {
    return this.reports.summary(q.date);
  }

  @Get('reports/active-subscribers')
  @ApiOperation({ summary: 'Currently active subscribers', description: 'Who is subscribed right now, their verse type and progress.' })
  @ApiOkResponse({ type: ActiveSubscribersDto })
  activeSubscribers(@Query() q: ActiveSubscribersQuery): Promise<ActiveSubscribersDto> {
    return this.reports.activeSubscribers(q);
  }

  @Get('reports/deliveries')
  @ApiOperation({
    summary: 'Messages delivered / failed on a day',
    description: 'Counts for one local day (default today): delivered, failed, pending, retries, per kind and verse type.',
  })
  @ApiOkResponse({ type: DeliveryReportDto })
  deliveryReport(@Query() q: DateQuery): Promise<DeliveryReportDto> {
    return this.reports.deliveryReport(q.date);
  }

  @Get('reports/repeats')
  @ApiOperation({ summary: 'Were any verses repeated?', description: '`repeated: false` means no subscriber got the same verse twice.' })
  @ApiOkResponse({ type: RepeatReportDto })
  repeats(): Promise<RepeatReportDto> {
    return this.reports.repeatReport();
  }

  @Get('deliveries')
  @ApiTags('Deliveries')
  @ApiOperation({
    summary: 'List messages with full attempt history',
    description: 'Each message with its status, failure / completion timestamps and every attempt (start, finish, outcome, error).',
  })
  @ApiOkResponse({ type: DeliveryListDto })
  list(@Query() q: DeliveriesQuery): Promise<DeliveryListDto> {
    return this.reports.listDeliveries(q);
  }

  @Get('deliveries/:id')
  @ApiTags('Deliveries')
  @ApiOperation({ summary: 'One message with its attempt history' })
  @ApiParam({ name: 'id', example: '42' })
  @ApiOkResponse({ type: DeliveryDto })
  one(@Param('id') id: string): Promise<DeliveryDto> {
    return this.reports.getDelivery(id);
  }

  @Post('deliveries/retry-failed')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Deliveries')
  @ApiOperation({
    summary: 'Re-run failed messages now',
    description:
      'Puts the day’s FAILED messages back in the queue (failed messages are also re-queued automatically every 10 minutes).',
  })
  @ApiOkResponse({ type: RequeueResultDto })
  async retryFailed(@Query() q: RetryFailedQuery): Promise<RequeueResultDto> {
    return { requeued: await this.reports.retryFailed(q.date, q.includePermanent) };
  }

  @Post('deliveries/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Deliveries')
  @ApiOperation({ summary: 'Re-run one failed or expired message' })
  @ApiParam({ name: 'id', example: '42' })
  @ApiOkResponse({ type: RequeueResultDto })
  async retryOne(@Param('id') id: string): Promise<RequeueResultDto> {
    return { requeued: await this.reports.retryOne(id) };
  }
}
