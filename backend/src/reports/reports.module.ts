import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { VersesModule } from '../verses/verses.module';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  imports: [DeliveryModule, VersesModule],
  controllers: [ReportsController],
  providers: [ReportsRepository, ReportsService],
})
export class ReportsModule {}
