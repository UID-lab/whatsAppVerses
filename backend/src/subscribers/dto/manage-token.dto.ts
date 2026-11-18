import { Matches } from 'class-validator';

export class ManageTokenParams {
  @Matches(/^[a-f0-9]{32}$/, { message: 'Invalid link' })
  token: string;
}
