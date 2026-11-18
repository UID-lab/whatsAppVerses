import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length } from 'class-validator';
import { VerseType } from '@prisma/client';

export class CreateSubscriberDto {
  /** Any common format; normalized server-side to E.164 (India assumed without a country code). */
  @IsString()
  @Length(6, 32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phone: string;

  @IsEnum(VerseType, { message: 'verseType must be BIBLE or GITA' })
  verseType: VerseType;
}
