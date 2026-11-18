import { AdminPage } from './pages/AdminPage';
import { ManagePage } from './pages/ManagePage';
import { SubscribePage } from './pages/SubscribePage';

/** Three pages; a router library would be overkill. The host must serve index.html for all paths. */
export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const page = path === '/manage' || path === '/unsubscribe' ? <ManagePage /> : path === '/admin' ? <AdminPage /> : <SubscribePage />;
  return (
    <div className="shell">
      <header className="brand">
        <a href="/" className="brand-link">
          <span className="brand-mark" aria-hidden>
            ✦
          </span>
          Daily Verse
        </a>
      </header>
      <main className="card">{page}</main>
      <footer className="foot">
        Free and opt-in. Reply <b>STOP</b> on WhatsApp anytime to unsubscribe.
      </footer>
    </div>
  );
}
