import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { SubscribersModule } from '../subscribers/subscribers.module';
import { VersesModule } from '../verses/verses.module';
import { AdminController } from './admin.controller';

@Module({ imports: [DeliveryModule, SubscribersModule, VersesModule], controllers: [AdminController] })
export class AdminModule {}
