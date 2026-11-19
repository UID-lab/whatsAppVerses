import { Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryKind, DeliveryStatus, Prisma, VerseType } from '@prisma/client';
import { localDate, toIsoDate } from '../common/time/time.util';
import { AppConfigService } from '../config/app-config.service';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { DeliveryWorkerService } from '../delivery/delivery-worker.service';
import { VersesService } from '../verses/verses.service';
import { ActiveSubscribersQuery, DeliveriesQuery } from './dto/report-query.dto';
import {
  ActiveSubscribersDto,
  DeliveryDto,
  DeliveryListDto,
  DeliveryReportDto,
  KindCountsDto,
  RepeatReportDto,
  SummaryDto,
  VerseCountDto,
} from './dto/report-responses.dto';
import { ReportsRepository } from './reports.repository';

const PENDING_STATUSES: DeliveryStatus[] = ['PENDING', 'PROCESSING', 'SENDING'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly worker: DeliveryWorkerService,
    private readonly verses: VersesService,
    private readonly config: AppConfigService,
  ) {}

  private get tz() {
    return this.config.get('APP_TIMEZONE');
  }

  /** "2026-11-19" → that local day; undefined → today in APP_TIMEZONE. */
  dayOf(date?: string): Date {
    return date ? new Date(`${date}T00:00:00.000Z`) : localDate(this.tz);
  }

  async activeSubscribers(q: ActiveSubscribersQuery): Promise<ActiveSubscribersDto> {
    const today = localDate(this.tz);
    const [byVerseType, rows] = await Promise.all([
      this.repo.activeCountsByType(),
      this.repo.activeSubscribers(today, q.limit, q.offset, q.verseType),
    ]);
    const pools = await this.poolSizes();
    return {
      total: q.verseType ? byVerseType[q.verseType] : Object.values(byVerseType).reduce((a, b) => a + b, 0),
      byVerseType,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phoneE164,
        verseType: r.verseType,
        status: r.status,
        subscribedAt: r.optedInAt,
        lastDeliveredAt: r.lastDeliveredAt,
        versesReceived: r.progress,
        versesRemaining: Math.max(0, pools[r.verseType] - Number(r.assignedOfType)),
        todaysVerseStatus: r.todaysVerseStatus,
      })),
    };
  }

  async deliveryReport(date?: string): Promise<DeliveryReportDto> {
    const day = this.dayOf(date);
    const { byKindStatus, permanent, recovered, attempts, dailyByType } = await this.repo.deliveryCounts(day);
    const count = (kind: DeliveryKind | null, statuses: DeliveryStatus[] | null) =>
      byKindStatus
        .filter((r) => (kind === null || r.kind === kind) && (statuses === null || statuses.includes(r.status)))
        .reduce((n, r) => n + r._count._all, 0);
    const kindCounts = (kind: DeliveryKind): KindCountsDto => ({
      total: count(kind, null),
      delivered: count(kind, ['SENT']),
      failed: count(kind, ['FAILED']),
      pending: count(kind, PENDING_STATUSES),
    });
    const attemptsOf = (o: string) => Number(attempts.find((a) => a.outcome === o)?.n ?? 0);
    const dailyDeliveredByVerseType = { BIBLE: 0, GITA: 0, QURAN: 0 } as Record<VerseType, number>;
    for (const r of dailyByType) dailyDeliveredByVerseType[r.type] = Number(r.n);
    return {
      date: toIsoDate(day),
      timezone: this.tz,
      total: count(null, null),
      delivered: count(null, ['SENT']),
      failed: count(null, ['FAILED']),
      failedPermanently: permanent,
      pending: count(null, PENDING_STATUSES),
      skipped: count(null, ['SKIPPED']),
      expired: count(null, ['EXPIRED']),
      unknown: count(null, ['UNKNOWN']),
      recoveredAfterFailure: recovered,
      successfulAttempts: attemptsOf('SUCCEEDED'),
      failedAttempts: attemptsOf('FAILED'),
      welcome: kindCounts('WELCOME'),
      daily: kindCounts('DAILY'),
      dailyDeliveredByVerseType,
    };
  }

  async repeatReport(): Promise<RepeatReportDto> {
    const [pairs, checked, history] = await Promise.all([
      this.repo.repeatedPairs(50),
      this.repo.countVerseDeliveries(),
      this.repo.countHistory(),
    ]);
    return {
      repeated: pairs.length > 0,
      repeatedPairs: pairs.length,
      checkedDeliveries: checked,
      historyRows: history,
      examples: pairs.map((p) => ({ ...p, timesSent: Number(p.timesSent) })),
      explanation:
        'Every verse given to a subscriber is recorded in subscriber_verses with PRIMARY KEY (subscriberId, verseId), ' +
        'so MySQL rejects a second assignment of the same verse. This report additionally scans all verse deliveries ' +
        'kept in the deliveries table for any subscriber+verse pair sent more than once.',
    };
  }

  async versesInDatabase(): Promise<Record<VerseType, VerseCountDto>> {
    const out = {} as Record<VerseType, VerseCountDto>;
    for (const r of await this.repo.versesInDatabase()) {
      out[r.type] = { stored: Number(r.stored), inRotation: Number(r.inRotation), translation: r.translation };
    }
    return out;
  }

  async summary(date?: string): Promise<SummaryDto> {
    const [active, deliveries, repeats, versesInDatabase] = await Promise.all([
      this.repo.activeCountsByType(),
      this.deliveryReport(date),
      this.repeatReport(),
      this.versesInDatabase(),
    ]);
    return {
      date: deliveries.date,
      activeSubscribers: Object.values(active).reduce((a, b) => a + b, 0),
      activeByVerseType: active,
      deliveries,
      repeats,
      versesInDatabase,
    };
  }

  async listDeliveries(q: DeliveriesQuery): Promise<DeliveryListDto> {
    const where: Prisma.DeliveryWhereInput = { deliveryDate: this.dayOf(q.date), ...(q.status ? { status: q.status } : {}) };
    const [total, rows] = await this.repo.listDeliveries(where, q.limit, q.offset);
    return { total, items: rows.map((d) => this.toDeliveryDto(d)) };
  }

  async getDelivery(id: string): Promise<DeliveryDto> {
    if (!/^\d+$/.test(id)) throw new NotFoundException('Delivery not found');
    const [, rows] = await this.repo.listDeliveries({ id: BigInt(id) }, 1, 0);
    if (!rows[0]) throw new NotFoundException('Delivery not found');
    return this.toDeliveryDto(rows[0]);
  }

  async retryFailed(date: string | undefined, includePermanent: boolean): Promise<number> {
    const n = await this.deliveries.requeueFailed({ date: this.dayOf(date), includePermanent });
    if (n) this.worker.wake();
    return n;
  }

  async retryOne(id: string): Promise<number> {
    if (!/^\d+$/.test(id)) throw new NotFoundException('Delivery not found');
    const n = await this.deliveries.requeueFailed({ ids: [BigInt(id)], includePermanent: true });
    if (n) this.worker.wake();
    return n;
  }

  private async poolSizes(): Promise<Record<VerseType, number>> {
    const [BIBLE, GITA, QURAN] = await Promise.all([
      this.verses.poolSize('BIBLE'),
      this.verses.poolSize('GITA'),
      this.verses.poolSize('QURAN'),
    ]);
    return { BIBLE, GITA, QURAN };
  }

  private toDeliveryDto(
    d: Prisma.DeliveryGetPayload<{ include: { subscriber: true; verse: true; attemptLog: true } }>,
  ): DeliveryDto {
    return {
      id: d.id.toString(),
      date: toIsoDate(d.deliveryDate),
      kind: d.kind,
      status: d.status,
      subscriberId: d.subscriberId,
      name: d.subscriber.name,
      phone: d.subscriber.phoneE164,
      verse: d.verse?.reference ?? null,
      attempts: d.attempts,
      requeueCount: d.requeueCount,
      createdAt: d.createdAt,
      firstFailedAt: d.firstFailedAt,
      lastFailedAt: d.lastFailedAt,
      completedAt: d.sentAt,
      lastError: d.lastError,
      failurePermanent: d.failurePermanent,
      attemptHistory: d.attemptLog.map((a) => ({
        attemptNo: a.attemptNo,
        outcome: a.outcome,
        error: a.error,
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
      })),
    };
  }
}
