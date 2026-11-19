import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) => (typeof value === 'string' ? value === 'true' : value);
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Every environment variable the backend reads. The app refuses to boot if any is invalid,
 * so misconfiguration fails fast at deploy time instead of at 7am when the cron fires.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @IsInt() @Min(1) @Max(65535)
  PORT: number = 3000;

  @IsString() @IsNotEmpty()
  DATABASE_URL: string;

  /** Comma-separated list of allowed browser origins for the React app. */
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:5173';

  /** Public URL of the React app; used to build unsubscribe links. */
  @IsUrl({ require_tld: false })
  PUBLIC_WEB_URL: string = 'http://localhost:5173';

  /** Protects /api/admin/* (QR linking, stats). Send as the `x-admin-key` header. */
  @IsString() @MinLength(24)
  ADMIN_API_KEY: string;

  @IsIn(['debug', 'log', 'warn', 'error'])
  LOG_LEVEL: 'debug' | 'log' | 'warn' | 'error' = 'log';

  /** Emit one JSON object per log line (recommended in production). */
  @Transform(toBool) @IsBoolean()
  LOG_JSON: boolean = false;

  /** Number of reverse proxies in front of the app (for correct client IPs in rate limiting). */
  @IsInt() @Min(0)
  TRUST_PROXY_HOPS: number = 1;

  // ---- Subscribers ---------------------------------------------------------------------------

  /** ISO-3166 region used when a number is typed without a country code. */
  @Matches(/^[A-Z]{2}$/)
  DEFAULT_PHONE_REGION: string = 'IN';

  /**
   * direct: subscribers are ACTIVE as soon as they submit the form and immediately get the
   * welcome message (simplest flow; we message people who haven't written to us first, which
   * carries more WhatsApp ban risk).
   * whatsapp_confirm: the user must first send "JOIN <code>" to our number (safer, proves
   * ownership of the number).
   */
  @IsIn(['whatsapp_confirm', 'direct'])
  OPT_IN_MODE: 'whatsapp_confirm' | 'direct' = 'direct';

  /**
   * What happens when a subscriber has received every verse of their type:
   * stop    — no more verses for them (a verse is never repeated). Default.
   * restart — start a fresh cycle (verses repeat, in the same order, after the whole pool).
   */
  @IsIn(['stop', 'restart'])
  ON_VERSES_EXHAUSTED: 'stop' | 'restart' = 'stop';

  /** Shown in the welcome message: "Thank you for subscribing to <BRAND_NAME>". */
  @IsString() @MinLength(1)
  BRAND_NAME: string = 'U!D Labs';

  @IsInt() @Min(1) @Max(720)
  CONFIRM_CODE_TTL_HOURS: number = 48;

  // ---- Scheduling ----------------------------------------------------------------------------

  /** IANA time zone used for "today", the daily send time and the send window. */
  @IsString()
  APP_TIMEZONE: string = 'Asia/Kolkata';

  /** Local time at which the day's deliveries are enqueued. */
  @Matches(HH_MM)
  DAILY_SEND_TIME: string = '07:00';

  /** Daily deliveries are only sent inside this local window (welcome replies are exempt). */
  @Matches(HH_MM)
  SEND_WINDOW_START: string = '07:00';

  @Matches(HH_MM)
  SEND_WINDOW_END: string = '21:30';

  @IsInt() @Min(100) @Max(50_000)
  ENQUEUE_BATCH_SIZE: number = 1000;

  @IsInt() @Min(1) @Max(3650)
  DELIVERY_RETENTION_DAYS: number = 30;

  // ---- Sending -------------------------------------------------------------------------------

  @IsIn(['baileys', 'console'])
  MESSAGING_PROVIDER: 'baileys' | 'console' = 'baileys';

  /** The WhatsApp number messages are sent from, digits only with country code. */
  @Matches(/^\d{8,15}$/)
  WA_PHONE_NUMBER: string = '918971775506';

  /** Key under which the linked-device session is stored in the whatsapp_auth table. */
  @Matches(/^[a-zA-Z0-9_-]{1,64}$/)
  WA_SESSION_ID: string = 'primary';

  /**
   * all    — API + scheduler + WhatsApp sender in one process (single free VM).
   * api    — HTTP API + scheduler only (scale these horizontally).
   * sender — owns the WhatsApp socket and the delivery worker (exactly one is active via a DB lease).
   */
  @IsIn(['all', 'api', 'sender'])
  PROCESS_ROLE: 'all' | 'api' | 'sender' = 'all';

  /** Average pace of outgoing messages. Keep this low on a personal number. */
  @IsInt() @Min(1) @Max(60)
  MESSAGES_PER_MINUTE: number = 6;

  /** Hard cap of messages per local day from this number (daily verses + replies). */
  @IsInt() @Min(1) @Max(100_000)
  DAILY_SEND_CAP: number = 400;

  @IsInt() @Min(1) @Max(20)
  MAX_DELIVERY_ATTEMPTS: number = 5;

  /**
   * After a message has used up its MAX_DELIVERY_ATTEMPTS, it is marked FAILED and put back in
   * the queue automatically (every 15 minutes) up to this many times on the same day. Failures
   * that can't succeed (e.g. number not on WhatsApp) are never auto-requeued.
   */
  @IsInt() @Min(0) @Max(20)
  FAILED_REQUEUE_LIMIT: number = 3;

  @IsInt() @Min(1) @Max(100)
  CLAIM_BATCH_SIZE: number = 10;

  /** Show a "typing…" indicator for a moment before each message (looks less bot-like). */
  @Transform(toBool) @IsBoolean()
  SIMULATE_TYPING: boolean = true;

  @IsOptional() @IsString()
  INSTANCE_ID?: string;

  /** Development only (console provider): fail the first N sends to each number, to test retries. */
  @IsInt() @Min(0) @Max(100)
  CONSOLE_FAIL_FIRST_ATTEMPTS: number = 0;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    const details = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
    throw new Error(`Invalid environment configuration:\n  - ${details.join('\n  - ')}`);
  }
  return validated;
}
