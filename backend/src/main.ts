import 'reflect-metadata';
import { ConsoleLogger, LogLevel, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

const LEVELS: Record<string, LogLevel[]> = {
  debug: ['debug', 'log', 'warn', 'error', 'fatal'],
  log: ['log', 'warn', 'error', 'fatal'],
  warn: ['warn', 'error', 'fatal'],
  error: ['error', 'fatal'],
};

async function bootstrap() {
  const level = process.env.LOG_LEVEL ?? 'log';
  const logger = new ConsoleLogger({
    json: process.env.LOG_JSON === 'true',
    logLevels: LEVELS[level] ?? LEVELS.log,
    timestamp: true,
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger, bufferLogs: true });
  const config = app.get(AppConfigService);

  app.set('trust proxy', config.get('TRUST_PROXY_HOPS'));
  // Swagger UI needs inline styles/scripts; the rest of the API keeps helmet's strict defaults.
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req: { path: string }, res: unknown, next: () => void) =>
    (req.path.startsWith('/api/docs') ? docs : strict)(req as never, res as never, next),
  );
  app.enableCors({ origin: config.corsOrigins, methods: ['GET', 'POST'], maxAge: 86400 });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: true }),
  );
  app.enableShutdownHooks();

  // Interactive API docs at /api/docs (JSON at /api/docs-json). Admin endpoints need the
  // x-admin-key header: click "Authorize" and paste ADMIN_API_KEY.
  const openApi = new DocumentBuilder()
    .setTitle('Daily Verse API')
    .setDescription(
      'Bible, Bhagavad Gita and Quran verses on WhatsApp. Public sign-up endpoints, plus admin reports: ' +
        'active subscribers, delivered / failed counts, delivery history with timestamps, and the no-repeat check.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-admin-key', description: 'ADMIN_API_KEY from backend/.env' }, 'admin-key')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, openApi), {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'list', tagsSorter: 'alpha' },
    customSiteTitle: 'Daily Verse API',
  });

  await app.listen(config.get('PORT'), '0.0.0.0');
  logger.log(
    `API listening on :${config.get('PORT')} — docs at /api/docs (role=${config.get('PROCESS_ROLE')}, provider=${config.get('MESSAGING_PROVIDER')}, instance=${config.instanceId})`,
    'Bootstrap',
  );
}

void bootstrap();
