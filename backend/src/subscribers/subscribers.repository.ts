import { Injectable } from '@nestjs/common';
import { Prisma, Subscriber, SubscriberStatus, VerseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscribersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phoneE164: string): Promise<Subscriber | null> {
    return this.prisma.subscriber.findUnique({ where: { phoneE164 } });
  }

  findByManageToken(manageToken: string): Promise<Subscriber | null> {
    return this.prisma.subscriber.findUnique({ where: { manageToken } });
  }

  findByConfirmCode(confirmCode: string): Promise<Subscriber | null> {
    return this.prisma.subscriber.findUnique({ where: { confirmCode } });
  }

  /** Match an inbound WhatsApp message to a subscriber: by reply address first, then by number. */
  async findByChannel(channelAddress: string, phoneE164: string | null, statuses: SubscriberStatus[]) {
    const byAddress = await this.prisma.subscriber.findFirst({ where: { channelAddress, status: { in: statuses } } });
    if (byAddress || !phoneE164) return byAddress;
    return this.prisma.subscriber.findFirst({ where: { phoneE164, status: { in: statuses } } });
  }

  create(data: Prisma.SubscriberCreateInput): Promise<Subscriber> {
    return this.prisma.subscriber.create({ data });
  }

  update(id: number, data: Prisma.SubscriberUpdateInput): Promise<Subscriber> {
    return this.prisma.subscriber.update({ where: { id }, data });
  }

  async countsByStatusAndType(): Promise<{ status: SubscriberStatus; verseType: VerseType; count: number }[]> {
    const rows = await this.prisma.subscriber.groupBy({ by: ['status', 'verseType'], _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, verseType: r.verseType, count: r._count._all }));
  }
}
