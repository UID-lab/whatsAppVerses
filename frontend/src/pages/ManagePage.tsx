import { useEffect, useState } from 'react';
import { api, ApiError, Subscription } from '../api';

/** Reached from the link in the welcome message: shows the subscription and lets the user opt out. */
export function ManagePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [sub, setSub] = useState<Subscription>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!/^[a-f0-9]{32}$/.test(token)) {
      setError('This link is invalid.');
      return;
    }
    api.getSubscription(token).then(setSub, (e) => setError(e instanceof ApiError ? e.message : 'Could not load subscription.'));
  }, [token]);

  const unsubscribe = async () => {
    setBusy(true);
    try {
      setSub(await api.unsubscribe(token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not unsubscribe.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!sub) return <p className="waiting"><span className="spinner" aria-hidden /> Loading…</p>;

  const label = sub.verseType === 'BIBLE' ? 'Bible verses' : 'Bhagavad Gita verses';
  return (
    <section>
      <h1>Your subscription</h1>
      <dl className="facts">
        {sub.name && (
          <>
            <dt>Name</dt>
            <dd>{sub.name}</dd>
          </>
        )}
        <dt>Number</dt>
        <dd>{sub.phone}</dd>
        <dt>Receiving</dt>
        <dd>{label}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`badge badge-${sub.status.toLowerCase()}`}>
            {sub.status === 'ACTIVE' ? 'Active' : sub.status === 'PENDING' ? 'Waiting for WhatsApp confirmation' : 'Unsubscribed'}
          </span>
        </dd>
      </dl>
      {sub.status !== 'UNSUBSCRIBED' ? (
        <button className="danger" onClick={unsubscribe} disabled={busy}>
          {busy ? 'Unsubscribing…' : 'Unsubscribe'}
        </button>
      ) : (
        <p className="lead">
          You won't receive any more messages. Changed your mind? Reply <b>START</b> on WhatsApp or <a href="/">subscribe again</a>.
        </p>
      )}
    </section>
  );
}
