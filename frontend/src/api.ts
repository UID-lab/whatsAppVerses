export type VerseType = 'BIBLE' | 'GITA';
export type SubscriberStatus = 'PENDING' | 'ACTIVE' | 'UNSUBSCRIBED';

export interface Subscription {
  name: string;
  status: SubscriberStatus;
  verseType: VerseType;
  phone: string;
  manageToken: string;
  confirmation: { code: string; message: string; whatsappUrl: string; expiresAt: string } | null;
}

export interface Options {
  optInMode: 'whatsapp_confirm' | 'direct';
  defaultRegion: string;
  sendTime: string;
  timezone: string;
  verseTypes: { id: VerseType; label: string; description: string }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') + '/api';

async function request<T>(path: string, init: RequestInit & { adminKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (init.adminKey) headers['x-admin-key'] = init.adminKey;
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message.join('. ') : body.message;
    throw new ApiError(msg || (res.status === 429 ? 'Too many attempts. Please wait a minute.' : 'Something went wrong.'), res.status);
  }
  return body as T;
}

export const api = {
  options: () => request<Options>('/subscribers/options'),
  subscribe: (name: string, phone: string, verseType: VerseType) =>
    request<Subscription>('/subscribers', { method: 'POST', body: JSON.stringify({ name, phone, verseType }) }),
  getSubscription: (token: string) => request<Subscription>(`/subscribers/manage/${encodeURIComponent(token)}`),
  unsubscribe: (token: string) =>
    request<Subscription>(`/subscribers/manage/${encodeURIComponent(token)}/unsubscribe`, { method: 'POST' }),

  admin: {
    whatsapp: (adminKey: string) => request<AdminWhatsApp>('/admin/whatsapp', { adminKey }),
    stats: (adminKey: string) => request<AdminStats>('/admin/stats', { adminKey }),
    pairingCode: (adminKey: string) =>
      request<{ code: string }>('/admin/whatsapp/pairing-code', { method: 'POST', adminKey, body: '{}' }),
    logout: (adminKey: string) => request<{ ok: boolean }>('/admin/whatsapp/logout', { method: 'POST', adminKey }),
    enqueueToday: (adminKey: string) =>
      request<{ enqueued: number }>('/admin/jobs/enqueue-today', { method: 'POST', adminKey }),
  },
};

export interface AdminWhatsApp {
  provider: string;
  phoneNumber: string;
  connection: string;
  account: string | null;
  lastError: string | null;
  updatedAt: string | null;
  qrDataUrl: string | null;
  senderOnThisInstance: boolean;
}

export interface AdminStats {
  date: string;
  subscribers: { status: SubscriberStatus; verseType: VerseType; count: number }[];
  deliveriesToday: Record<string, number>;
  sentToday: number;
  dailySendCap: number;
  messagesPerMinute: number;
  rotationPool: Record<VerseType, number>;
  repeatedVerses: number;
}
