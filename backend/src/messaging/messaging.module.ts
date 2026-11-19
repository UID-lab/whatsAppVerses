import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { BaileysMessagingProvider } from './baileys/baileys.provider';
import { ConsoleMessagingProvider } from './console.provider';
import { MESSAGING_PROVIDER, MessagingProvider } from './messaging.types';
import { OutboundService } from './outbound.service';
import { SenderLeadershipService } from './sender-leadership.service';
import { SenderStateRepository } from './sender-state.repository';

@Global()
@Module({
  providers: [
    SenderStateRepository,
    {
      provide: MESSAGING_PROVIDER,
      inject: [AppConfigService, PrismaService, SenderStateRepository],
      useFactory: (config: AppConfigService, prisma: PrismaService, state: SenderStateRepository): MessagingProvider => {
        switch (config.get('MESSAGING_PROVIDER')) {
          case 'console':
            return new ConsoleMessagingProvider(config.get('CONSOLE_FAIL_FIRST_ATTEMPTS'));
          case 'baileys':
          default:
            return new BaileysMessagingProvider(prisma, config, state);
        }
      },
    },
    OutboundService,
    SenderLeadershipService,
  ],
  exports: [MESSAGING_PROVIDER, OutboundService, SenderLeadershipService, SenderStateRepository],
})
export class MessagingModule {}
