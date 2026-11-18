import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { EnvironmentVariables } from './env.validation';

/** Typed, read-only access to validated configuration. Inject this instead of ConfigService. */
@Injectable()
export class AppConfigService {
  /** Unique per process; used as the lease holder and queue lock owner. */
  readonly instanceId: string;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    this.instanceId =
      this.get('INSTANCE_ID') ?? `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
  }

  get<K extends keyof EnvironmentVariables>(key: K): EnvironmentVariables[K] {
    return this.config.get(key, { infer: true });
  }

  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get runsSender(): boolean {
    return this.get('PROCESS_ROLE') !== 'api';
  }

  get runsScheduler(): boolean {
    return this.get('PROCESS_ROLE') !== 'sender';
  }
}
