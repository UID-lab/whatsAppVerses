import 'reflect-metadata';
import { ConsoleLogger, LogLevel, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, methods: ['GET', 'POST'], maxAge: 86400 });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: true }),
  );
  app.enableShutdownHooks();

  await app.listen(config.get('PORT'), '0.0.0.0');
  logger.log(
    `API listening on :${config.get('PORT')} (role=${config.get('PROCESS_ROLE')}, provider=${config.get('MESSAGING_PROVIDER')}, instance=${config.instanceId})`,
    'Bootstrap',
  );
}

void bootstrap();
