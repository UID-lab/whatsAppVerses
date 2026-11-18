import { Injectable } from '@nestjs/common';
import { Verse, VerseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VersesRepository {
  constructor(private readonly prisma: PrismaService) {}

  countRotation(type: VerseType): Promise<number> {
    return this.prisma.verse.count({ where: { type, rotationIndex: { not: null } } });
  }

  /** O(1) lookup through the unique (type, rotationIndex) index. */
  findByRotationIndex(type: VerseType, rotationIndex: number): Promise<Verse | null> {
    return this.prisma.verse.findUnique({ where: { type_rotationIndex: { type, rotationIndex } } });
  }
}
