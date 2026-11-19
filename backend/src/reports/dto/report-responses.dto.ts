import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttemptOutcome, DeliveryKind, DeliveryStatus, SubscriberStatus, VerseType } from '@prisma/client';

export class ActiveSubscriberDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Stanley' }) name: string;
  @ApiProperty({ example: '+918861286408' }) phone: string;
  @ApiProperty({ enum: VerseType }) verseType: VerseType;
  @ApiProperty({ enum: SubscriberStatus }) status: SubscriberStatus;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) subscribedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastDeliveredAt: Date | null;
  @ApiProperty({ description: 'Daily verses delivered so far' }) versesReceived: number;
  @ApiProperty({ description: 'Verses left before every verse of their type has been sent once' })
  versesRemaining: number;
  @ApiPropertyOptional({ enum: DeliveryStatus, nullable: true, description: "Status of today's daily verse" })
  todaysVerseStatus: DeliveryStatus | null;
}

export class ActiveSubscribersDto {
  @ApiProperty({ description: 'Total ACTIVE subscribers (matching the filter)' }) total: number;
  @ApiProperty({ example: { BIBLE: 3, GITA: 2, QURAN: 1 } }) byVerseType: Record<VerseType, number>;
  @ApiProperty({ type: [ActiveSubscriberDto] }) items: ActiveSubscriberDto[];
}

export class KindCountsDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Status SENT' }) delivered: number;
  @ApiProperty({ description: 'Status FAILED (gave up for now)' }) failed: number;
  @ApiProperty({ description: 'PENDING, PROCESSING or SENDING' }) pending: number;
}

export class DeliveryReportDto {
  @ApiProperty({ example: '2026-11-19' }) date: string;
  @ApiProperty({ example: 'Asia/Kolkata' }) timezone: string;
  @ApiProperty({ description: 'All messages for the day (welcome + daily)' }) total: number;
  @ApiProperty({ description: 'Successfully delivered (SENT)' }) delivered: number;
  @ApiProperty({ description: 'Currently FAILED' }) failed: number;
  @ApiProperty({ description: 'Of the failed: ones that can never succeed (not on WhatsApp)' }) failedPermanently: number;
  @ApiProperty({ description: 'Waiting or in progress' }) pending: number;
  @ApiProperty({ description: 'Skipped (unsubscribed, or every verse already sent)' }) skipped: number;
  @ApiProperty({ description: "Not sent before the day ended" }) expired: number;
  @ApiProperty({ description: 'Sender stopped mid-send; never retried (to avoid duplicates)' }) unknown: number;
  @ApiProperty({ description: 'Delivered after at least one failed attempt' }) recoveredAfterFailure: number;
  @ApiProperty({ description: 'Successful send attempts' }) successfulAttempts: number;
  @ApiProperty({ description: 'Failed send attempts (each retry counts)' }) failedAttempts: number;
  @ApiProperty({ type: KindCountsDto }) welcome: KindCountsDto;
  @ApiProperty({ type: KindCountsDto }) daily: KindCountsDto;
  @ApiProperty({ example: { BIBLE: 3, GITA: 1, QURAN: 1 }, description: 'Daily verses delivered, per type' })
  dailyDeliveredByVerseType: Record<VerseType, number>;
}

export class RepeatExampleDto {
  @ApiProperty() subscriberId: number;
  @ApiProperty() name: string;
  @ApiProperty({ example: 'John 3:16' }) reference: string;
  @ApiProperty() timesSent: number;
}

export class RepeatReportDto {
  @ApiProperty({ description: 'true if any subscriber was sent the same verse more than once' }) repeated: boolean;
  @ApiProperty({ description: 'Number of subscriber+verse pairs sent more than once' }) repeatedPairs: number;
  @ApiProperty({ description: 'Verse deliveries checked (within DELIVERY_RETENTION_DAYS)' }) checkedDeliveries: number;
  @ApiProperty({ description: 'Rows in the permanent no-repeat history (one per verse per subscriber)' })
  historyRows: number;
  @ApiProperty({ type: [RepeatExampleDto], description: 'Up to 50 examples, if any' }) examples: RepeatExampleDto[];
  @ApiProperty() explanation: string;
}

export class VerseCountDto {
  @ApiProperty({ description: 'Verses stored in the MySQL verses table' }) stored: number;
  @ApiProperty({ description: 'Of those, used for daily messages' }) inRotation: number;
  @ApiProperty({ example: 'KJV' }) translation: string;
}

export class SummaryDto {
  @ApiProperty({ example: '2026-11-19' }) date: string;
  @ApiProperty() activeSubscribers: number;
  @ApiProperty({ example: { BIBLE: 3, GITA: 2, QURAN: 1 } }) activeByVerseType: Record<VerseType, number>;
  @ApiProperty({ type: DeliveryReportDto }) deliveries: DeliveryReportDto;
  @ApiProperty({ type: RepeatReportDto }) repeats: RepeatReportDto;
  @ApiProperty({ type: Object, example: { BIBLE: { stored: 31102, inRotation: 10891, translation: 'KJV' } } })
  versesInDatabase: Record<VerseType, VerseCountDto>;
}

export class AttemptDto {
  @ApiProperty({ description: '1, 2, 3 … across all retry rounds' }) attemptNo: number;
  @ApiPropertyOptional({ enum: AttemptOutcome, nullable: true }) outcome: AttemptOutcome | null;
  @ApiPropertyOptional({ nullable: true }) error: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) finishedAt: Date | null;
}

export class DeliveryDto {
  @ApiProperty({ example: '42' }) id: string;
  @ApiProperty({ example: '2026-11-19' }) date: string;
  @ApiProperty({ enum: DeliveryKind }) kind: DeliveryKind;
  @ApiProperty({ enum: DeliveryStatus }) status: DeliveryStatus;
  @ApiProperty() subscriberId: number;
  @ApiProperty() name: string;
  @ApiProperty() phone: string;
  @ApiPropertyOptional({ nullable: true, example: 'Psalms 46:1' }) verse: string | null;
  @ApiProperty({ description: 'Attempts in the current round' }) attempts: number;
  @ApiProperty({ description: 'Times re-queued after FAILED' }) requeueCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) firstFailedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastFailedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'When it was delivered' })
  completedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) lastError: string | null;
  @ApiProperty() failurePermanent: boolean;
  @ApiProperty({ type: [AttemptDto] }) attemptHistory: AttemptDto[];
}

export class DeliveryListDto {
  @ApiProperty() total: number;
  @ApiProperty({ type: [DeliveryDto] }) items: DeliveryDto[];
}

export class RequeueResultDto {
  @ApiProperty({ description: 'Deliveries put back in the queue' }) requeued: number;
}
