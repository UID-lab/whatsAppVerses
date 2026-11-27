import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';
import { VerseType } from '@prisma/client';
import { OFFERED_VERSE_TYPES } from '../../verses/verse-types';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSubscriberDto {
  /** Used to greet the subscriber ("Hi Priya,"). Letters in any script, spaces, . ' - */
  // class-validator runs these bottom-up; with stopAtFirstError the first failure is reported.
  @Matches(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, { message: 'Name can only contain letters, spaces, dots, apostrophes and hyphens.' })
  @MaxLength(60, { message: 'Name must be 60 characters or fewer.' })
  @IsNotEmpty({ message: 'Please enter your name.' })
  @IsString({ message: 'Please enter your name.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @ApiProperty({ example: 'Stanley', maxLength: 60 })
  name: string;

  /** Any common format; normalized server-side to E.164 (India assumed without a country code). */
  @IsString()
  @Length(6, 32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ApiProperty({ example: '8861286408', description: 'Any format; India (+91) assumed without a country code' })
  phone: string;

  @IsIn(OFFERED_VERSE_TYPES, { message: `verseType must be one of ${OFFERED_VERSE_TYPES.join(', ')}` })
  @ApiProperty({ enum: OFFERED_VERSE_TYPES, example: 'RAMAYANA' })
  verseType: VerseType;
}
