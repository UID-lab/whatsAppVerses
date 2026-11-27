import { isValidPhoneNumber, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, Options, Subscription, VerseType } from '../api';
import { QrImage } from '../components/QrImage';

type Step = 'phone' | 'type' | 'confirm' | 'done';

const VERSE_ICONS: Record<VerseType, string> = { BIBLE: '📖', RAMAYANA: '🏹', MAHABHARATA: '🐚', QURAN: '🌙', GITA: '🪷' };
const VERSE_NAMES: Record<VerseType, string> = {
  BIBLE: 'Bible',
  RAMAYANA: 'Ramayana',
  MAHABHARATA: 'Mahabharata',
  QURAN: 'Quran',
  GITA: 'Bhagavad Gita',
};

type VerseOption = Options['verseTypes'][number];
/** Consecutive options with the same `group` become one block (e.g. Ramayana | Mahabharata). */
function groupOptions(options: VerseOption[]): { group?: string; items: VerseOption[] }[] {
  const out: { group?: string; items: VerseOption[] }[] = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (o.group && last?.group === o.group) last.items.push(o);
    else out.push({ group: o.group, items: [o] });
  }
  return out;
}

export function SubscribePage() {
  const [step, setStep] = useState<Step>('phone');
  const [options, setOptions] = useState<Options>();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [verseType, setVerseType] = useState<VerseType>();
  const [subscription, setSubscription] = useState<Subscription>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.options().then(setOptions).catch(() => undefined);
  }, []);

  const region = (options?.defaultRegion ?? 'IN') as CountryCode;

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name.trim())) {
      setError('Name can only contain letters, spaces, dots, apostrophes and hyphens.');
      return;
    }
    if (!isValidPhoneNumber(phone, region)) {
      setError('Please enter a valid mobile number (country code optional for India).');
      return;
    }
    setStep('type');
  };

  const choose = async (type: VerseType) => {
    setVerseType(type);
    setBusy(true);
    setError(undefined);
    try {
      const sub = await api.subscribe(name.trim(), phone, type);
      setSubscription(sub);
      setStep(sub.status === 'ACTIVE' ? 'done' : 'confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      if (err instanceof ApiError && err.status === 409) setStep('phone');
    } finally {
      setBusy(false);
    }
  };

  const onConfirmed = useCallback((s: Subscription) => {
    setSubscription(s);
    setStep('done');
  }, []);

  const formatted = parsePhoneNumberFromString(phone, region)?.formatInternational() ?? phone;

  return (
    <>
      <Progress step={step} withConfirm={options?.optInMode === 'whatsapp_confirm'} />
      {step === 'phone' && (
        <form onSubmit={submitPhone} noValidate>
          <h1 className="hero-title">
            Daily Verse to walk in the <span className="gradient-text">Joyful Path</span>{' '}
            <span aria-hidden>🤩</span>
          </h1>
          <p className="lead">
            Get one Bible, Ramayana, Mahabharata or Quran verse every day{options ? ` at ${options.sendTimeLabel ?? options.sendTime}` : ''}.
          </p>
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            type="text"
            autoComplete="given-name"
            placeholder="Eg : Mary  "
            maxLength={60}
            value={name}
            onChange={(e) => (setName(e.target.value), setError(undefined))}
            autoFocus
          />
          <div className="field-gap" />
          <label htmlFor="phone">Your WhatsApp number</label>
          <div className="phone-field">
            <span className="prefix">{region === 'IN' ? '🇮🇳 +91' : '+'}</span>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => (setPhone(e.target.value), setError(undefined))}
              aria-invalid={!!error}
              aria-describedby="phone-help"
            />
          </div>
          <p id="phone-help" className="help">
            Numbers outside India: include the country code, e.g. +1 415 555 0100.
          </p>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" type="submit">
            Continue
          </button>
        </form>
      )}

      {step === 'type' && (
        <section>
          <h1>What would you like to receive?</h1>
          <p className="lead">
            Hi {name.trim().split(' ')[0]}! Verses will be sent to <b>{formatted}</b>.{' '}
            <button className="link" onClick={() => setStep('phone')}>
              Change
            </button>
          </p>
          <div className="choices">
            {groupOptions(options?.verseTypes ?? defaultTypes).map((g) =>
              g.group ? (
                <div key={g.group} className="choice-group" role="group" aria-label={g.group}>
                  <div className="choice-group-title">{g.group}</div>
                  <div className="choice-split">
                    {g.items.map((t) => (
                      <button
                        key={t.id}
                        className="choice choice-half"
                        disabled={busy}
                        onClick={() => choose(t.id)}
                        aria-busy={busy && verseType === t.id}
                      >
                        <span className="choice-icon" aria-hidden>
                          {VERSE_ICONS[t.id]}
                        </span>
                        <span className="choice-title">{t.label}</span>
                        <span className="choice-desc">{t.description}</span>
                        {busy && verseType === t.id && <span className="spinner" aria-label="Saving" />}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                g.items.map((t) => (
                  <button key={t.id} className="choice" disabled={busy} onClick={() => choose(t.id)} aria-busy={busy && verseType === t.id}>
                    <span className="choice-icon" aria-hidden>
                      {VERSE_ICONS[t.id]}
                    </span>
                    <span className="choice-title">{t.label}</span>
                    <span className="choice-desc">{t.description}</span>
                    {busy && verseType === t.id && <span className="spinner" aria-label="Saving" />}
                  </button>
                ))
              ),
            )}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      )}

      {step === 'confirm' && subscription?.confirmation && (
        <ConfirmStep subscription={subscription} onConfirmed={onConfirmed} />
      )}

      {step === 'done' && subscription && <Done subscription={subscription} />}
    </>
  );
}

const defaultTypes: Options['verseTypes'] = [
  { id: 'BIBLE', label: 'Bible verses', description: 'King James Version' },
  { id: 'RAMAYANA', label: 'Ramayana', description: 'The full story, a part a day', group: 'Indian epics' },
  { id: 'MAHABHARATA', label: 'Mahabharata', description: 'Daily teachings of wisdom', group: 'Indian epics' },
  { id: 'QURAN', label: 'Quran verses', description: 'Arabic with English translation (Pickthall)' },
];

function Progress({ step, withConfirm }: { step: Step; withConfirm: boolean }) {
  const steps: Step[] = withConfirm ? ['phone', 'type', 'confirm'] : ['phone', 'type'];
  const labels = withConfirm ? ['Your details', 'Verses', 'Confirm'] : ['Your details', 'Verses'];
  const current = step === 'done' ? steps.length : steps.indexOf(step);
  return (
    <ol className="progress" aria-label="Progress">
      {labels.map((label, i) => (
        <li key={label} className={i < current ? 'complete' : i === current ? 'current' : ''}>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** Waits for the "JOIN <code>" WhatsApp message to arrive (the backend flips status to ACTIVE). */
function ConfirmStep({ subscription, onConfirmed }: { subscription: Subscription; onConfirmed: (s: Subscription) => void }) {
  const c = subscription.confirmation!;
  const timer = useRef<number>(undefined);

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await api.getSubscription(subscription.manageToken);
        if (s.status === 'ACTIVE') return onConfirmed(s);
      } catch {
        /* keep polling */
      }
      timer.current = window.setTimeout(poll, 4000);
    };
    timer.current = window.setTimeout(poll, 4000);
    return () => window.clearTimeout(timer.current);
  }, [subscription.manageToken, onConfirmed]);

  return (
    <section>
      <h1>One last step</h1>
      <p className="lead">
        To confirm it's really you, send this message to us on WhatsApp from <b>{subscription.phone}</b>:
      </p>
      <div className="code-box" aria-label="Confirmation message">
        {c.message}
      </div>
      <a className="primary wa" href={c.whatsappUrl} target="_blank" rel="noreferrer">
        Open WhatsApp and send
      </a>
      <div className="desktop-only">
        <p className="help">On a computer? Scan this with your phone's camera:</p>
        <QrImage value={c.whatsappUrl} label="QR code that opens WhatsApp with the confirmation message" />
      </div>
      <p className="waiting">
        <span className="spinner" aria-hidden /> Waiting for your message… this page updates automatically.
      </p>
      <p className="help">The code expires {new Date(c.expiresAt).toLocaleString()}.</p>
    </section>
  );
}

function Done({ subscription }: { subscription: Subscription }) {
  const manageUrl = `${window.location.origin}/manage?token=${subscription.manageToken}`;
  return (
    <section className="center">
      <div className="success-mark" aria-hidden>
        ✓
      </div>
      <h1>Thank you{subscription.name ? `, ${subscription.name.split(' ')[0]}` : ''}!</h1>
      <p className="lead">
        You'll get a welcome message on WhatsApp at {subscription.phone} in a moment. Your daily{' '}
        {VERSE_NAMES[subscription.verseType]} verses start tomorrow morning.
      </p>
      <p className="help">
        Reply <b>STOP</b> on WhatsApp to unsubscribe, or keep this link: <a href={manageUrl}>manage subscription</a>.
      </p>
    </section>
  );
}
