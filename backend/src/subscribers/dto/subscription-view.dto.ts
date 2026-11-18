import { SubscriberStatus, VerseType } from '@prisma/client';

/** What the API returns about a subscription. Never includes the full phone number. */
export interface SubscriptionView {
  status: SubscriberStatus;
  verseType: VerseType;
  phone: string; // masked
  manageToken: string;
  /** Present while status is PENDING: how to finish opting in on WhatsApp. */
  confirmation: { code: string; message: string; whatsappUrl: string; expiresAt: string } | null;
}
