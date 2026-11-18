import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class PairingCodeDto {
  /** Defaults to WA_PHONE_NUMBER. Digits only, with country code. */
  @IsOptional()
  @Matches(/^\d{8,15}$/)
  phone?: string;
}

export class SimulateInboundDto {
  @IsString()
  @Length(6, 32)
  phone: string;

  @IsString()
  @Length(1, 200)
  text: string;
}
