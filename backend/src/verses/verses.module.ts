import { Module } from '@nestjs/common';
import { VersesRepository } from './verses.repository';
import { VersesService } from './verses.service';

@Module({ providers: [VersesRepository, VersesService], exports: [VersesService] })
export class VersesModule {}
