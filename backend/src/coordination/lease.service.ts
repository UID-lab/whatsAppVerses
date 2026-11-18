import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';

/**
 * Distributed leases on a MySQL row — leader election without Redis/ZooKeeper.
 *
 * tryAcquire() is a single atomic upsert: it takes the lease if it is free, expired, or already
 * ours (renewal), and leaves it alone otherwise. All timestamps come from the database clock,
 * so clock skew between replicas doesn't matter.
 */
@Injectable()
export class LeaseService {
  private readonly logger = new Logger(LeaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  get holderId(): string {
    return this.config.instanceId;
  }

  async tryAcquire(name: string, ttlSeconds: number): Promise<boolean> {
    const holder = this.holderId;
    // MySQL evaluates SET clauses left to right, so `holder` is updated first; the expiresAt
    // condition then sees holder = ours and extends it — exactly when we won the lease.
    await this.prisma.$executeRaw`
      INSERT INTO leases (name, holder, expiresAt)
      VALUES (${name}, ${holder}, NOW(3) + INTERVAL ${ttlSeconds} SECOND)
      ON DUPLICATE KEY UPDATE
        holder    = IF(expiresAt < NOW(3) OR holder = ${holder}, ${holder}, holder),
        expiresAt = IF(holder = ${holder}, NOW(3) + INTERVAL ${ttlSeconds} SECOND, expiresAt)`;
    const rows = await this.prisma.$queryRaw<{ holder: string }[]>`SELECT holder FROM leases WHERE name = ${name}`;
    return rows[0]?.holder === holder;
  }

  async release(name: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`DELETE FROM leases WHERE name = ${name} AND holder = ${this.holderId}`;
    } catch (err) {
      this.logger.warn(`Could not release lease ${name}: ${(err as Error).message}`);
    }
  }
}
