import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { VersesModule } from '../verses/verses.module';
import { InboundCommandsService } from './inbound-commands.service';
import { SubscribersController } from './subscribers.controller';
import { SubscribersRepository } from './subscribers.repository';
import { SubscribersService } from './subscribers.service';

@Module({
  imports: [DeliveryModule, VersesModule],
  controllers: [SubscribersController],
  providers: [SubscribersRepository, SubscribersService, InboundCommandsService],
  exports: [SubscribersRepository],
})
export class SubscribersModule {}
