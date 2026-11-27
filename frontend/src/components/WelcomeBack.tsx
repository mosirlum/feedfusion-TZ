import { useEffect, useRef, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dashboardApi } from '../lib/api';
import { tzs } from '../lib/format';

/**
 * "Welcome back" voice greeting + since-you-last-logged-in summary
 * (2026-11-27, CLAUDE.md #99) — the client's own request, built for real
 * (not the earlier design mockup): fires once right after a real sign-in
 * (never on a page refresh — see the `ff_welcome_pending` flag
 * AuthContext.login() sets and this component clears). Every number comes
 * from `GET /dashboard/welcome-back`, which reads the same tables the rest
 * of the app already shows — nothing here is invented or AI-generated.
 *
 * Mounted once in AppShell, outside the page's own layout.
 */
export default function WelcomeBack() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [sentence, setSentence] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const spokenRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('ff_welcome_pending');
      sessionStorage.removeItem('ff_welcome_pending'); // one-shot: never repeats on refresh
    } catch {
      return;
    }
    if (!raw) return;

    (async () => {
      let since: string | null = null;
      try {
        since = (JSON.parse(raw!) as { previousLoginAt: string | null }).previousLoginAt;
      } catch {
        return;
      }

      const firstName = (user.name ?? '').trim().split(/\s+/)[0] || 'there';

      if (!since) {
        // First-ever login for this account — nothing to summarize yet.
        const text = `Welcome, ${firstName}.`;
        setSentence(text);
        setLines([]);
        setVisible(true);
        speak(text);
        return;
      }

      try {
        const res = await dashboardApi.welcomeBack(since);
        const s = res.data;
        if (!s) {
          setVisible(false);
          return;
        }
        const whenText = sinceText(since);
        const parts: string[] = [];
        const spoken: string[] = [`Welcome back, ${firstName}.`];

        if (s.salesCount > 0) {
          parts.push(`${s.salesCount} sale${s.salesCount === 1 ? '' : 's'} · ${tzs(s.salesTotal)}`);
          spoken.push(
            `Since ${whenText}, you made ${s.salesCount} sale${s.salesCount === 1 ? '' : 's'} worth ${tzs(s.salesTotal)}.`
          );
        } else {
          spoken.push(`There have been no sales since ${whenText}.`);
        }
        if (s.newCreditCount > 0) {
          parts.push(`${s.newCreditCount} new credit sale${s.newCreditCount === 1 ? '' : 's'} · ${tzs(s.newCreditAmount)} to collect`);
          spoken.push(`${s.newCreditCount} customer${s.newCreditCount === 1 ? '' : 's'} bought on credit.`);
        }
        if (typeof s.lowStockCount === 'number' && s.lowStockCount > 0) {
          parts.push(`${s.lowStockCount} product${s.lowStockCount === 1 ? '' : 's'} low or out of stock`);
          spoken.push(`${s.lowStockCount} product${s.lowStockCount === 1 ? '' : 's'} are low or out of stock.`);
        }
        if (typeof s.pendingApprovalsCount === 'number' && s.pendingApprovalsCount > 0) {
          parts.push(`${s.pendingApprovalsCount} change${s.pendingApprovalsCount === 1 ? '' : 's'} waiting for approval`);
          spoken.push(`${s.pendingApprovalsCount} change${s.pendingApprovalsCount === 1 ? '' : 's'} are waiting for your approval.`);
        }

        setSentence(`Welcome back, ${firstName}. Since ${whenText}:`);
        setLines(parts);
        setVisible(true);
        speak(spoken.join(' '));
      } catch {
        /* no summary available (e.g. offline) — not worth bothering the user with an error here */
      }
    })();
  }, [user]);

  function speak(text: string) {
    if (spokenRef.current) return; // StrictMode double-invoke guard
    spokenRef.current = true;
    try {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.98;
      synth.speak(u);
    } catch {
      /* no speech support on this device — the visual card still shows */
    }
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed bottom-5 right-5 z-50 w-full max-w-sm rounded-2xl border border-white/10 bg-[#11211a] p-4 text-[#e9f1eb] shadow-2xl animate-fade-in sm:bottom-6 sm:right-6"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-lime-400/15 text-lime-300">
          <Volume2 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{sentence}</p>
          {lines.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px] text-[#a9bcae]">
              {lines.map((l, i) => (
                <li key={i}>&bull; {l}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="flex-none rounded-lg p-1 text-[#8fa596] hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function sinceText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'your last visit';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `earlier today (${time})`;
  const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 1) return `yesterday`;
  if (diffDays > 1 && diffDays < 14) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
