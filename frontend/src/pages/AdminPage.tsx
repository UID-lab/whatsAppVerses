import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AdminStats, AdminWhatsApp, api, ApiError } from '../api';

const KEY_STORAGE = 'verse-admin-key';

const readKey = () => {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
};

/** Operator page: link the WhatsApp number (QR or pairing code) and watch delivery stats. */
export function AdminPage() {
  const [key, setKey] = useState(readKey);
  const [draft, setDraft] = useState('');
  const [wa, setWa] = useState<AdminWhatsApp>();
  const [stats, setStats] = useState<AdminStats>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    if (!key) return;
    try {
      const [w, s] = await Promise.all([api.admin.whatsapp(key), api.admin.stats(key)]);
      setWa(w);
      setStats(s);
      setError(undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setKey('');
        try {
          sessionStorage.removeItem(KEY_STORAGE);
        } catch {
          /* ignore */
        }
      }
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [key]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, wa?.connection === 'open' ? 15000 : 3000);
    return () => window.clearInterval(t);
  }, [refresh, wa?.connection]);

  const login = (e: FormEvent) => {
    e.preventDefault();
    try {
      sessionStorage.setItem(KEY_STORAGE, draft);
    } catch {
      /* ignore */
    }
    setKey(draft);
  };

  const run = async (fn: () => Promise<string>) => {
    setNotice(undefined);
    try {
      setNotice(await fn());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (!key) {
    return (
      <form onSubmit={login}>
        <h1>Admin</h1>
        <label htmlFor="key">Admin API key</label>
        <input id="key" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="current-password" />
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">
          Sign in
        </button>
      </form>
    );
  }

  return (
    <section>
      <h1>WhatsApp sender</h1>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {wa && (
        <>
          <dl className="facts">
            <dt>Number</dt>
            <dd>+{wa.phoneNumber}</dd>
            <dt>Connection</dt>
            <dd>
              <span className={`badge badge-${wa.connection === 'open' ? 'active' : 'pending'}`}>{wa.connection}</span>
            </dd>
            <dt>Provider</dt>
            <dd>{wa.provider}</dd>
            {wa.lastError && (
              <>
                <dt>Last error</dt>
                <dd>{wa.lastError}</dd>
              </>
            )}
          </dl>
          {wa.qrDataUrl && (
            <div className="center">
              <p className="lead">
                On the phone with +{wa.phoneNumber}: WhatsApp → <b>Settings → Linked devices → Link a device</b>, then scan:
              </p>
              <img className="qr" src={wa.qrDataUrl} width={280} height={280} alt="WhatsApp link QR code" />
              <p className="help">The code refreshes every ~20 seconds. Prefer typing a code instead?</p>
              <button className="secondary" onClick={() => run(async () => `Pairing code: ${(await api.admin.pairingCode(key)).code} — enter it under "Link with phone number instead".`)}>
                Get pairing code
              </button>
            </div>
          )}
          <div className="row">
            <button className="secondary" onClick={() => run(async () => `Enqueued ${(await api.admin.enqueueToday(key)).enqueued} deliveries`)}>
              Enqueue today now
            </button>
            {wa.connection === 'open' && (
              <button className="danger" onClick={() => window.confirm('Unlink this server from WhatsApp?') && run(async () => (await api.admin.logout(key), 'Logged out'))}>
                Unlink device
              </button>
            )}
          </div>
        </>
      )}

      {stats && (
        <>
          <h2>Today ({stats.date})</h2>
          <p>
            Sent {stats.sentToday} / {stats.dailySendCap} (cap) · pace {stats.messagesPerMinute}/min
          </p>
          <p>
            Verse pool: {stats.rotationPool.BIBLE} Bible · {stats.rotationPool.GITA} Gita · {stats.rotationPool.QURAN} Quran · Repeated verses:{' '}
            <span className={`badge badge-${stats.repeatedVerses === 0 ? 'active' : 'pending'}`}>{stats.repeatedVerses}</span>
          </p>
          <table className="table">
            <tbody>
              {Object.entries(stats.deliveriesToday).map(([status, n]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Subscribers</h2>
          <table className="table">
            <tbody>
              {stats.subscribers.map((r) => (
                <tr key={r.status + r.verseType}>
                  <td>{r.verseType}</td>
                  <td>{r.status}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
