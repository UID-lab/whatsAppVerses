import { Module } from '@nestjs/common';
import { VersesModule } from '../verses/verses.module';
import { DeliveryRepository } from './delivery.repository';
import { DeliverySchedulerService } from './delivery-scheduler.service';
import { DeliveryWorkerService } from './delivery-worker.service';

@Module({
  imports: [VersesModule],
  providers: [DeliveryRepository, DeliverySchedulerService, DeliveryWorkerService],
  exports: [DeliveryRepository, DeliverySchedulerService, DeliveryWorkerService],
})
export class DeliveryModule {}
