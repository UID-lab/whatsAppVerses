import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { DeliveryStatus, VerseType } from '@prisma/client';

export class DateQuery {
  @ApiPropertyOptional({ description: 'Local date (APP_TIMEZONE), YYYY-MM-DD. Defaults to today.', example: '2026-11-19' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

export class PageQuery {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset: number = 0;
}

export class ActiveSubscribersQuery extends PageQuery {
  @ApiPropertyOptional({ enum: VerseType, description: 'Only subscribers of this verse type' })
  @IsOptional() @IsEnum(VerseType)
  verseType?: VerseType;
}

export class DeliveriesQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Local date, YYYY-MM-DD. Defaults to today.', example: '2026-11-19' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ enum: DeliveryStatus, description: 'Only deliveries in this status' })
  @IsOptional() @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;
}

export class RetryFailedQuery extends DateQuery {
  @ApiPropertyOptional({
    default: false,
    description: 'Also retry failures marked permanent (e.g. number not on WhatsApp)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includePermanent: boolean = false;
}
