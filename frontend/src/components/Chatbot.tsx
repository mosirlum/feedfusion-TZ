import { FormEvent, useEffect, useState } from 'react';
import { Send, X } from 'lucide-react';
import clsx from 'clsx';
import RobotAvatar from './RobotAvatar';
import { useAuth } from '../context/AuthContext';
import { businessGrowthApi, reportsApi } from '../lib/api';
import { tzs } from '../lib/format';
import type { GrowthOverviewMonth, ProfitDoctorReport } from '../types';

/**
 * Msaidizi — the free, rule-based help chatbot (2026-11-27, CLAUDE.md #99).
 * The client's own choice over a paid AI chatbot: a fixed bank of common
 * questions and answers, in English and Kiswahili, with simple keyword
 * matching on free-typed questions. No network call, no per-use cost.
 *
 * A question this bank doesn't recognize offers "send to developer" — this
 * first version only confirms the offer and logs it to the browser console;
 * it does not yet save anywhere the owner can read later (no backend table
 * exists for feature requests). Flagged here rather than silently faked:
 * add a real `feature_requests` table + endpoint before relying on this for
 * anything the owner must actually see.
 */
type Lang = 'en' | 'sw';

interface FaqEntry {
  q: Record<Lang, string>;
  a?: Record<Lang, string>;
  steps?: Record<Lang, string[]>;
  match: RegExp;
  /** Answered live from real numbers instead of a fixed text (see askAnalysis). */
  analysis?: boolean;
}

const FAQ: FaqEntry[] = [
  {
    q: { en: 'How do I sell on credit?', sw: 'Nauzaje kwa deni?' },
    a: {
      en: 'Selling on credit (kwa deni):',
      sw: 'Kuuza kwa deni:',
    },
    steps: {
      en: [
        'Open Point of Sale and add the products.',
        'Choose a saved customer — credit needs a name.',
        'Type what the customer pays now (can be less than the total), then tick "Give on credit".',
        'Pick the date the rest is due, then Complete Sale.',
        'The balance then shows under Sales History and on the Dashboard as money owed.',
      ],
      sw: [
        'Fungua Point of Sale na uongeze bidhaa.',
        'Chagua mteja aliyehifadhiwa — deni linahitaji jina.',
        'Andika kiasi anacholipa sasa (kinaweza kuwa chini ya jumla), kisha weka tiki "Give on credit".',
        'Chagua tarehe ya kulipa salio, kisha Complete Sale.',
        'Salio linaonekana kwenye Sales History na kwenye Dashboard kama deni.',
      ],
    },
    match: /credit|deni|kopa/i,
  },
  {
    q: { en: 'How do I record a purchase?', sw: 'Narekodi vipi manunuzi?' },
    a: { en: 'Recording stock that arrived:', sw: 'Kurekodi mzigo ulioingia:' },
    steps: {
      en: [
        'Open Purchases.',
        'Choose the supplier (or add a new one inline).',
        'Add each product with its quantity and unit cost.',
        'Add transport or labour if you paid for it.',
        'Press Record Purchase — stock goes up automatically.',
      ],
      sw: [
        'Fungua Purchases.',
        'Chagua msambazaji (au ongeza mpya papo hapo).',
        'Ongeza kila bidhaa na idadi na bei ya kununua.',
        'Ongeza usafiri au vibarua kama ulilipa.',
        'Bonyeza Record Purchase — stoo inaongezeka yenyewe.',
      ],
    },
    match: /purchase|manunuzi|nunua|supplier|msambazaji/i,
  },
  {
    q: { en: 'Why is my profit small?', sw: 'Kwa nini faida ni ndogo?' },
    a: {
      en: 'Open Reports → Sales and read "Profit Doctor" at the top of the page. It shows what you spend buying products, your expenses, and which prices are below a healthy margin — with a suggested price for each.',
      sw: 'Fungua Reports → Sales, soma "Profit Doctor" juu ya ukurasa. Inaonyesha unachotumia kununua bidhaa, matumizi, na bei zipi ziko chini ya faida nzuri — pamoja na bei inayopendekezwa.',
    },
    match: /profit|faida|margin/i,
  },
  {
    q: { en: 'How do I add a new product?', sw: 'Naongeza vipi bidhaa mpya?' },
    a: { en: 'Products → Add Product. Pick a category (or add one inline), name, unit, and minimum stock. A price is set separately — the owner sets it directly; a sales user proposes one for the owner to approve.', sw: 'Products → Add Product. Chagua category (au ongeza mpya papo hapo), jina, unit, na stock ya chini. Bei inawekwa tofauti — mwenye duka anaweka moja kwa moja; mfanyakazi anapendekeza na mwenye duka anaidhinisha.' },
    match: /new product|add product|bidhaa mpya|ongeza bidhaa/i,
  },
  {
    q: { en: 'How do I void a sale?', sw: 'Nabatilishaje mauzo?' },
    a: { en: 'Open Sales History, find the sale, and use the void action on that row (owner only). Stock is given back automatically and it stays on record — completed sales are never deleted.', sw: 'Fungua Sales History, tafuta mauzo, bonyeza void kwenye row hiyo (mwenye duka pekee). Stoo inarudishwa yenyewe, na mauzo hubaki kwenye rekodi — mauzo yaliyokamilika hayafutwi kabisa.' },
    match: /void|batilish|cancel sale/i,
  },
  // "Analyst" mode (2026-11-27, CLAUDE.md #99 follow-up): answered live from
  // real numbers (businessGrowthApi.monthlyOverview + reportsApi.profitDoctor),
  // not a fixed sentence — see askAnalysis() below. Owner-only (BR-24: cost
  // and profit figures aren't shown to sales staff anywhere else either).
  {
    q: { en: 'Why am I making a loss this month?', sw: 'Kwa nini nina hasara mwezi huu?' },
    match: /\bloss\b|hasara|kwa nini.*(faida|hasara)|why.*(loss|profit)|analysis|uchambuzi|je.*biashara inakwendaje/i,
    analysis: true,
  },
];

const UNKNOWN = {
  en: 'I don’t have an answer for that yet.',
  sw: 'Sina jibu la hilo bado.',
};

interface ChatMsg {
  from: 'bot' | 'me';
  text: string;
  steps?: string[];
  offerRequest?: string; // the original question, if this was an "unknown" reply
  requested?: boolean;
}

export default function Chatbot() {
  const { isOwner } = useAuth();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [draft, setDraft] = useState('');
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  // Robot "talks" (mouth pulses) for a moment right after it replies — a
  // small emotional touch the client asked for, on top of its always-on
  // float/blink/occasional-wink.
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (msgs.length === 0 || msgs[msgs.length - 1]?.from !== 'bot') return;
    setTalking(true);
    const t = window.setTimeout(() => setTalking(false), 1400);
    return () => window.clearTimeout(t);
  }, [msgs]);

  function ask(entry: FaqEntry | null, freeText?: string) {
    const question = entry ? entry.q[lang] : freeText ?? '';
    if (entry?.analysis) {
      askAnalysis(question);
      setDraft('');
      return;
    }
    const me: ChatMsg = { from: 'me', text: question };
    let bot: ChatMsg;
    if (entry) {
      bot = { from: 'bot', text: entry.a![lang], steps: entry.steps?.[lang] };
    } else {
      bot = {
        from: 'bot',
        text:
          UNKNOWN[lang] +
          (lang === 'en'
            ? '\nShall I send it to your developer as a feature request?'
            : '\nNimtumie msanidi wako kama ombi la kipengele kipya?'),
        offerRequest: question,
      };
    }
    setMsgs((prev) => [...prev, me, bot]);
    setDraft('');
  }

  // "Analyst" answer (2026-11-27) — reads the SAME live endpoints the
  // Business Growth and Reports pages already use (never a separate,
  // driftable copy of the numbers), picks the month's worst finding, and
  // speaks the answer the same way WelcomeBack.tsx does.
  async function askAnalysis(question: string) {
    const me: ChatMsg = { from: 'me', text: question };
    const checking: ChatMsg = { from: 'bot', text: lang === 'en' ? 'Let me check the numbers…' : 'Nakagua takwimu…' };
    setMsgs((prev) => [...prev, me, checking]);
    const replaceLast = (text: string) =>
      setMsgs((prev) => {
        const next = prev.slice();
        next[next.length - 1] = { from: 'bot', text };
        return next;
      });

    if (!isOwner) {
      replaceLast(
        lang === 'en'
          ? 'This kind of analysis is only available to the shop owner.'
          : 'Uchambuzi wa aina hii unapatikana kwa mwenye duka pekee.'
      );
      return;
    }
    try {
      const overviewRes = await businessGrowthApi.monthlyOverview();
      const months = overviewRes.data.months;
      const current = months[months.length - 1];
      const doctorRes = await reportsApi.profitDoctor(current.from, current.to);
      const text = buildAnalysisAnswer(current, doctorRes.data, lang);
      replaceLast(text);
      speak(text);
    } catch {
      replaceLast(lang === 'en' ? 'Could not load the analysis right now.' : 'Imeshindwa kupata uchambuzi sasa.');
    }
  }

  function speak(text: string) {
    try {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.98;
      synth.speak(u);
    } catch {
      /* no speech support on this device — the text reply still shows */
    }
  }

  function matchFree(text: string): FaqEntry | null {
    return FAQ.find((f) => f.match.test(text)) ?? null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    ask(matchFree(text), text);
  }

  function sendToDeveloper(msgIndex: number, question: string) {
    // Logged only (see file header) — no feature-requests table exists yet.
    // eslint-disable-next-line no-console
    console.info('[Msaidizi] feature request:', question);
    setMsgs((prev) => {
      const next = prev.slice();
      next[msgIndex] = { ...next[msgIndex], requested: true };
      next.push({ from: 'bot', text: lang === 'en' ? 'Sent. Thank you!' : 'Imetumwa. Asante!' });
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close help chat' : 'Open help chat'}
        className="fixed bottom-5 left-5 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-green-600 shadow-2xl transition hover:bg-green-700 hover:scale-105 active:scale-95 dark:bg-lime-400 dark:hover:bg-lime-300 sm:bottom-6 sm:left-6"
      >
        {open ? <X size={22} className="text-white dark:text-[#0b1712]" /> : <RobotAvatar size={44} waving />}
      </button>

      {open && (
        <div className="fixed bottom-24 left-5 z-50 flex h-[min(560px,70vh)] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#11211a] sm:left-6">
          <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/10">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-green-50 dark:bg-lime-400/15">
              <RobotAvatar size={30} talking={talking} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-slate-800 dark:text-[#e9f1eb]">Msaidizi</p>
              <p className="text-xs text-slate-500 dark:text-[#8fa596]">
                {lang === 'en' ? 'Ask how to do anything' : 'Uliza jinsi ya kufanya chochote'}
              </p>
            </div>
            <div className="flex flex-none items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06]">
              {(['en', 'sw'] as Lang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={clsx(
                    'rounded-md px-2 py-1 text-xs font-bold',
                    lang === l
                      ? 'bg-white text-slate-800 shadow-sm dark:bg-[#1c2a23] dark:text-lime-300'
                      : 'text-slate-400 dark:text-[#8fa596]'
                  )}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <Bubble from="bot">
              {lang === 'en'
                ? 'Hi! Tap a question below or type your own.'
                : 'Habari! Gusa swali hapa chini au andika lako.'}
            </Bubble>
            {msgs.map((m, i) => (
              <Bubble key={i} from={m.from}>
                <span className="whitespace-pre-line">{m.text}</span>
                {m.steps && m.steps.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    {m.steps.map((s, j) => (
                      <li key={j}>{s}</li>
                    ))}
                  </ol>
                )}
                {m.offerRequest && !m.requested && (
                  <button
                    type="button"
                    onClick={() => sendToDeveloper(i, m.offerRequest!)}
                    className="mt-2 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white dark:bg-lime-400 dark:text-[#0b1712]"
                  >
                    {lang === 'en' ? 'Yes, send to developer' : 'Ndiyo, mtumie msanidi'}
                  </button>
                )}
              </Bubble>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 pt-2.5 dark:border-white/10">
            {FAQ.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => ask(f)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-[#d2dbd5] dark:hover:bg-white/5"
              >
                {f.q[lang]}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="flex gap-2 px-3 pb-3 pt-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={lang === 'en' ? 'Type a question…' : 'Andika swali…'}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-[#e9f1eb]"
            />
            <button
              type="submit"
              aria-label="Send"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-green-600 text-white dark:bg-lime-400 dark:text-[#0b1712]"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

const MONTH_NAMES: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  sw: ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'],
};

function formatMonthLabel(yyyyMm: string, lang: Lang): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const name = MONTH_NAMES[lang][(m ?? 1) - 1] ?? yyyyMm;
  return `${name} ${y}`;
}

function verdictText(verdict: GrowthOverviewMonth['verdict'], lang: Lang): string {
  const map: Record<GrowthOverviewMonth['verdict'], Record<Lang, string>> = {
    profit: { en: 'profit', sw: 'faida' },
    loss: { en: 'loss', sw: 'hasara' },
    breakeven: { en: 'break-even result (no real profit or loss)', sw: 'hali ya mlingano (hakuna faida wala hasara)' },
    no_data: { en: 'no activity yet', sw: 'bado hakuna mauzo' },
  };
  return map[verdict][lang];
}

function buildAnalysisAnswer(month: GrowthOverviewMonth, doctor: ProfitDoctorReport, lang: Lang): string {
  const monthLabel = formatMonthLabel(month.month, lang);
  const net = month.metrics.netProfit;
  const margin = month.marginPct;
  const verdictWord = verdictText(month.verdict, lang);
  const marginText =
    margin !== null
      ? lang === 'en'
        ? ` (${margin.toFixed(1)}% margin)`
        : ` (asilimia ${margin.toFixed(1)} ya mauzo)`
      : '';
  const headline =
    lang === 'en'
      ? `${monthLabel} is showing a ${verdictWord} of ${tzs(Math.abs(net))}${marginText}.`
      : `${monthLabel} inaonyesha ${verdictWord} ya ${tzs(Math.abs(net))}${marginText}.`;

  const worst =
    doctor.findings.find((f) => f.severity === 'critical') ??
    doctor.findings.find((f) => f.severity === 'warning') ??
    doctor.findings[0];
  if (!worst) return headline;

  const reason = lang === 'en' ? ` Biggest issue: ${worst.what} ${worst.why}` : ` Tatizo kubwa: ${worst.what} ${worst.why}`;
  const action = worst.actions[0] ? (lang === 'en' ? ` What to do: ${worst.actions[0]}` : ` Ufanye nini: ${worst.actions[0]}`) : '';
  return (headline + reason + action).trim();
}

function Bubble({ from, children }: { from: 'bot' | 'me'; children: React.ReactNode }) {
  return (
    <div className={clsx('flex', from === 'me' ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
          from === 'me'
            ? 'rounded-br-md bg-green-600 text-white dark:bg-lime-400 dark:text-[#0b1712]'
            : 'rounded-bl-md border border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-[#d2dbd5]'
        )}
      >
        {children}
      </div>
    </div>
  );
}
