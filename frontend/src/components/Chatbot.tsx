import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Mic, Send, Volume2, VolumeX, X } from 'lucide-react';
import clsx from 'clsx';
import RobotAvatar, { type RobotMood } from './RobotAvatar';
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
 * Behaves like "Crowny" in Crowned Perfumes: the robot's face changes with
 * what it is doing (thinking, happy, wink, sad), it waves and says "Need a
 * hand?" now and then while closed, answers come with steps and an "Open
 * page" button, and it offers "Help with this page" for the screen you are
 * on. On top of that Msaidizi ANALYSES the real numbers (this month's
 * result, this month vs last month) and can talk: every answer has a Listen
 * button, the speaker switch reads every answer aloud, and the mic button
 * lets you ask by voice (browser speech, no cost; where a device has no
 * speech support those buttons simply do not show).
 *
 * "Send to developer" on an unanswered question only logs to the browser
 * console: no feature-requests table exists yet (CLAUDE.md #99). Add a real
 * table + endpoint before relying on it.
 */
type Lang = 'en' | 'sw';
type L = Record<Lang, string>;

interface FaqEntry {
  id: string;
  q: L;
  a?: L;
  steps?: Record<Lang, string[]>;
  match: RegExp;
  /** The page that does it: shown as an "Open" button. */
  page?: { href: string; label: string };
  /** Answered live from real numbers instead of a fixed text (see askAnalysis). */
  analysis?: 'loss' | 'compare';
}

// Pages a sales user cannot open: no "Open" button for them.
const OWNER_ONLY_PAGES = ['/reports', '/business-growth', '/audit-log', '/users', '/settings', '/stock-adjustments', '/approvals'];

const FAQ: FaqEntry[] = [
  // Analyst questions: answered live from real numbers (monthlyOverview +
  // profitDoctor), owner only (BR-24: cost/profit is not shown to sales staff).
  {
    id: 'compare',
    q: { en: 'How is my business doing?', sw: 'Biashara inakwendaje?' },
    match: /compare|last month|mwezi uliopita|growth|ukuaji|how.*(business|doing)|biashara.*(vipi|inakwendaje)|je.*biashara/i,
    analysis: 'compare',
    page: { href: '/business-growth', label: 'Business Growth' },
  },
  {
    id: 'loss',
    q: { en: 'Why am I making a loss this month?', sw: 'Kwa nini nina hasara mwezi huu?' },
    match: /\bloss\b|hasara|kwa nini.*(faida|hasara)|why.*(loss|profit)|analysis|uchambuzi/i,
    analysis: 'loss',
    page: { href: '/reports', label: 'Reports' },
  },
  {
    id: 'credit',
    q: { en: 'How do I sell on credit?', sw: 'Nauzaje kwa deni?' },
    a: { en: 'Selling on credit (kwa deni):', sw: 'Kuuza kwa deni:' },
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
    page: { href: '/pos', label: 'Point of Sale' },
  },
  {
    id: 'purchase',
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
    page: { href: '/purchases', label: 'Purchases' },
  },
  {
    id: 'profit',
    q: { en: 'Why is my profit small?', sw: 'Kwa nini faida ni ndogo?' },
    a: {
      en: 'Open Reports → Sales and read "Profit Doctor" at the top of the page. It shows what you spend buying products, your expenses, and which prices are below a healthy margin — with a suggested price for each.',
      sw: 'Fungua Reports → Sales, soma "Profit Doctor" juu ya ukurasa. Inaonyesha unachotumia kununua bidhaa, matumizi, na bei zipi ziko chini ya faida nzuri — pamoja na bei inayopendekezwa.',
    },
    match: /profit|faida|margin/i,
    page: { href: '/reports', label: 'Reports' },
  },
  {
    id: 'newproduct',
    q: { en: 'How do I add a new product?', sw: 'Naongeza vipi bidhaa mpya?' },
    a: { en: 'Products → Add Product. Pick a category (or add one inline), name, unit, and minimum stock. A price is set separately — the owner sets it directly; a sales user proposes one for the owner to approve.', sw: 'Products → Add Product. Chagua category (au ongeza mpya papo hapo), jina, unit, na stock ya chini. Bei inawekwa tofauti — mwenye duka anaweka moja kwa moja; mfanyakazi anapendekeza na mwenye duka anaidhinisha.' },
    match: /new product|add product|bidhaa mpya|ongeza bidhaa/i,
    page: { href: '/products', label: 'Products' },
  },
  {
    id: 'void',
    q: { en: 'How do I void a sale?', sw: 'Nabatilishaje mauzo?' },
    a: { en: 'Open Sales History, find the sale, and use the void action on that row (owner only). Stock is given back automatically and it stays on record — completed sales are never deleted.', sw: 'Fungua Sales History, tafuta mauzo, bonyeza void kwenye row hiyo (mwenye duka pekee). Stoo inarudishwa yenyewe, na mauzo hubaki kwenye rekodi — mauzo yaliyokamilika hayafutwi kabisa.' },
    match: /void|batilish|cancel sale/i,
    page: { href: '/sales-history', label: 'Sales History' },
  },
  {
    id: 'approvals',
    q: { en: 'A price proposal is waiting', sw: 'Kuna bei inasubiri idhini' },
    a: { en: 'Sales staff can propose a price; the owner approves or rejects it under Price Approvals. Until it is approved, the old price stays in use.', sw: 'Mfanyakazi anaweza kupendekeza bei; mwenye duka anaidhinisha au kukataa kwenye Price Approvals. Hadi iidhinishwe, bei ya zamani inaendelea kutumika.' },
    match: /approv|idhin|propos|pendekez/i,
    page: { href: '/approvals', label: 'Price Approvals' },
  },
  {
    id: 'expense',
    q: { en: 'How do I record an expense?', sw: 'Narekodi vipi matumizi?' },
    a: { en: 'Open Expenses, add the expense with its category, amount and date, then save. Expenses are taken off your profit in Reports and Business Growth, so record them the day they happen.', sw: 'Fungua Expenses, ongeza matumizi pamoja na category, kiasi na tarehe, kisha hifadhi. Matumizi yanapunguzwa kwenye faida ndani ya Reports na Business Growth, kwa hiyo yarekodi siku yanapotokea.' },
    match: /expense|matumizi|gharama/i,
    page: { href: '/expenses', label: 'Expenses' },
  },
  {
    id: 'count',
    q: { en: 'How do I count stock?', sw: 'Nahesabu vipi stoo?' },
    a: { en: 'Open Stock Count, enter what you really find on the shelf for each product, then save. The system compares it with what it expects so you can see what is missing or extra.', sw: 'Fungua Stock Count, andika unachokikuta kweli kwenye rafu kwa kila bidhaa, kisha hifadhi. Mfumo unalinganisha na unachotarajia ili uone kilichopungua au kilichozidi.' },
    match: /stock count|count stock|hesabu|kuhesabu|kagua stoo|stocktake/i,
    page: { href: '/stock-count', label: 'Stock Count' },
  },
  {
    id: 'quote',
    q: { en: 'How do I make a quotation?', sw: 'Natengenezaje nukuu (quotation)?' },
    a: { en: 'Open Quotations → new quotation, choose the customer, add the products and print or save it as PDF. Delivery Notes work the same way.', sw: 'Fungua Quotations → new quotation, chagua mteja, ongeza bidhaa kisha uchapishe au uihifadhi kama PDF. Delivery Notes zinafanana.' },
    match: /quotation|quote|nukuu|delivery note/i,
    page: { href: '/quotations', label: 'Quotations' },
  },
  {
    id: 'print',
    q: { en: 'How do I print a receipt or save a PDF?', sw: 'Nachapishaje risiti au kuhifadhi PDF?' },
    a: { en: 'Open the sale in Sales History and use the Print / Save as PDF button on the receipt.', sw: 'Fungua mauzo kwenye Sales History kisha tumia kitufe cha Print / Save as PDF kwenye risiti.' },
    match: /print|pdf|receipt|risiti|chapa/i,
    page: { href: '/sales-history', label: 'Sales History' },
  },
  {
    id: 'sell',
    q: { en: 'How do I make a sale?', sw: 'Nauzaje?' },
    a: { en: 'Selling is done on Point of Sale:', sw: 'Kuuza kunafanyika kwenye Point of Sale:' },
    steps: {
      en: ['Open Point of Sale and add the products and quantities.', 'Choose how the customer pays.', 'Press Complete Sale — the receipt opens and you can print it.'],
      sw: ['Fungua Point of Sale na uongeze bidhaa na idadi.', 'Chagua njia ya malipo.', 'Bonyeza Complete Sale — risiti inafunguka na unaweza kuichapisha.'],
    },
    match: /\bsell\b|selling|make a sale|new sale|uza|kuuza|mauzo mapya|\bpos\b/i,
    page: { href: '/pos', label: 'Point of Sale' },
  },
];

// Which help topic belongs to which screen ("Help with this page").
const PAGE_TOPIC: [string, string][] = [
  ['/pos', 'sell'], ['/sales-history', 'print'], ['/purchases', 'purchase'], ['/products', 'newproduct'],
  ['/expenses', 'expense'], ['/stock-count', 'count'], ['/reports', 'profit'], ['/business-growth', 'compare'],
  ['/dashboard', 'compare'], ['/approvals', 'approvals'], ['/quotations', 'quote'], ['/delivery-notes', 'quote'],
];
const byId = (id: string) => FAQ.find((f) => f.id === id);
const topicForPath = (path: string) => {
  const hit = PAGE_TOPIC.find(([p]) => path === p || path.startsWith(p + '/'));
  return hit ? byId(hit[1]) : undefined;
};
const DEFAULT_CHIPS = ['compare', 'sell', 'expense', 'count'];

const UNKNOWN: L = {
  en: 'I don’t have an answer for that yet.',
  sw: 'Sina jibu la hilo bado.',
};

interface ChatMsg {
  id: number;
  from: 'bot' | 'me';
  text: string;
  steps?: string[];
  page?: { href: string; label: string };
  chips?: string[]; // FAQ ids
  offerRequest?: string; // the original question, if this was an "unknown" reply
  requested?: boolean;
}

// Browser speech recognition (Chrome/Edge/Safari), typed loosely: not in every TS lib.
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function getRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const canSpeak = () => typeof window !== 'undefined' && !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined';

const VOICE_KEY = 'ff_bot_autoread';

export default function Chatbot() {
  const { isOwner, user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [draft, setDraft] = useState('');
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [mood, setMood] = useState<RobotMood>('idle');
  const [bubble, setBubble] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoRead, setAutoRead] = useState(() => {
    try {
      return localStorage.getItem(VOICE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const next = useRef(1);
  const box = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const rec = useRef<Recognition | null>(null);
  const speechOk = canSpeak();
  const micOk = typeof window !== 'undefined' && !!getRecognition();

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      try {
        window.speechSynthesis?.cancel();
        rec.current?.stop();
      } catch {
        /* nothing to stop */
      }
    },
    []
  );
  const flash = useCallback(
    (m: RobotMood, ms = 3500) => {
      setMood(m);
      later(() => setMood('idle'), ms);
    },
    [later]
  );

  const speak = useCallback(
    (text: string) => {
      if (!speechOk) return;
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === 'sw' ? 'sw-TZ' : 'en-US';
        u.rate = 0.98;
        u.onstart = () => setSpeaking(true);
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        synth.speak(u);
      } catch {
        /* no speech on this device — the text reply still shows */
      }
    },
    [lang, speechOk]
  );
  const toggleAutoRead = () => {
    const v = !autoRead;
    setAutoRead(v);
    try {
      localStorage.setItem(VOICE_KEY, v ? '1' : '0');
    } catch {
      /* private mode: just for this visit */
    }
    if (!v) {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* nothing playing */
      }
      setSpeaking(false);
    }
  };

  const say = useCallback(
    (m: Omit<ChatMsg, 'id' | 'from'>, readAloud: boolean) => {
      setMsgs((prev) => [...prev, { id: next.current++, from: 'bot', ...m }]);
      if (readAloud) speak(m.text + (m.steps ? ' ' + m.steps.join('. ') : ''));
    },
    [speak]
  );

  const firstName = (user?.name ?? '').trim().split(/\s+/)[0];

  // The first time it opens: say hello and offer what people ask most (and help for the page they are on).
  useEffect(() => {
    if (!open || msgs.length) return;
    const here = topicForPath(pathname);
    const ids = [...(here ? [here.id] : []), ...DEFAULT_CHIPS.filter((id) => id !== here?.id)].slice(0, 5);
    setMsgs([
      {
        id: next.current++,
        from: 'bot',
        text:
          lang === 'en'
            ? `Hi${firstName ? ' ' + firstName : ''}! I'm Msaidizi, your helper. Tap a question or type your own — I can also look at your numbers.`
            : `Habari${firstName ? ' ' + firstName : ''}! Mimi ni Msaidizi. Gusa swali au andika lako — naweza pia kuangalia takwimu zako.`,
        chips: ids,
      },
    ]);
    flash('wink', 3000);
  }, [open, msgs.length, lang, firstName, pathname, flash]);

  // While closed: now and then wave, wink and say "Need a hand?" so people notice it is there.
  useEffect(() => {
    if (open) return;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      setBubble(true);
      setMood('wink');
      later(() => {
        setBubble(false);
        setMood('idle');
      }, 4200);
      later(loop, 70000);
    };
    later(loop, 12000);
    return () => {
      alive = false;
    };
  }, [open, later]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, thinking]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pageFor = (e: FaqEntry) => (e.page && (isOwner || !OWNER_ONLY_PAGES.includes(e.page.href)) ? e.page : undefined);
  const chipsFor = (excludeId?: string) => DEFAULT_CHIPS.filter((id) => id !== excludeId).slice(0, 4);

  function ask(entry: FaqEntry | null, freeText?: string) {
    const question = entry ? entry.q[lang] : freeText ?? '';
    if (!question.trim() || thinking) return;
    setMsgs((prev) => [...prev, { id: next.current++, from: 'me', text: question }]);
    setDraft('');
    if (entry?.analysis) {
      void askAnalysis(entry.analysis);
      return;
    }
    setThinking(true);
    setMood('think');
    later(() => {
      if (entry) {
        say({ text: entry.a![lang], steps: entry.steps?.[lang], page: pageFor(entry), chips: chipsFor(entry.id) }, autoRead);
        flash('happy', 4500);
      } else {
        say(
          {
            text:
              UNKNOWN[lang] +
              (lang === 'en'
                ? '\nShall I send it to your developer as a feature request?'
                : '\nNimtumie msanidi wako kama ombi la kipengele kipya?'),
            offerRequest: question,
            chips: chipsFor(),
          },
          autoRead
        );
        flash('sad', 6000);
      }
      setThinking(false);
    }, 600);
  }

  // Analyst answers read the SAME live endpoints the Business Growth and
  // Reports pages use (never a separate, driftable copy of the numbers).
  async function askAnalysis(kind: 'loss' | 'compare') {
    setThinking(true);
    setMood('think');
    const entry = byId(kind)!;
    if (!isOwner) {
      say(
        {
          text: lang === 'en' ? 'This kind of analysis is only available to the shop owner.' : 'Uchambuzi wa aina hii unapatikana kwa mwenye duka pekee.',
          chips: chipsFor(kind),
        },
        autoRead
      );
      setThinking(false);
      flash('sad', 4000);
      return;
    }
    try {
      const overviewRes = await businessGrowthApi.monthlyOverview();
      const months = overviewRes.data.months;
      const current = months[months.length - 1];
      let text: string;
      if (kind === 'compare') {
        text = buildCompareAnswer(current, months[months.length - 2], lang);
      } else {
        const doctorRes = await reportsApi.profitDoctor(current.from, current.to);
        text = buildAnalysisAnswer(current, doctorRes.data, lang);
      }
      say({ text, page: pageFor(entry), chips: chipsFor(kind) }, true); // an analysis is always spoken once
      flash(current.verdict === 'loss' ? 'sad' : 'happy', 5000);
    } catch {
      say({ text: lang === 'en' ? 'Could not load the analysis right now.' : 'Imeshindwa kupata uchambuzi sasa.', chips: chipsFor(kind) }, false);
      flash('sad', 4000);
    }
    setThinking(false);
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

  function startListening() {
    const Ctor = getRecognition();
    if (!Ctor || listening) return;
    try {
      const r = new Ctor();
      r.lang = lang === 'sw' ? 'sw-TZ' : 'en-US';
      r.interimResults = false;
      r.onresult = (e) => {
        const text = e.results[0]?.[0]?.transcript?.trim();
        if (text) ask(matchFree(text), text);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      rec.current = r;
      setListening(true);
      r.start();
    } catch {
      setListening(false);
    }
  }

  function sendToDeveloper(msgId: number, question: string) {
    // Logged only (see file header) — no feature-requests table exists yet.
    // eslint-disable-next-line no-console
    console.info('[Msaidizi] feature request:', question);
    setMsgs((prev) => [
      ...prev.map((m) => (m.id === msgId ? { ...m, requested: true } : m)),
      { id: next.current++, from: 'bot', text: lang === 'en' ? 'Sent. Thank you!' : 'Imetumwa. Asante!' },
    ]);
  }

  const faceMood: RobotMood = thinking ? 'think' : mood;
  const lastBotId = [...msgs].reverse().find((m) => m.from === 'bot')?.id;

  return (
    <>
      {!open && bubble && (
        <button
          type="button"
          onClick={() => {
            setBubble(false);
            setOpen(true);
          }}
          className="fixed bottom-[5.6rem] left-5 z-50 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-lg dark:border-white/10 dark:bg-[#11211a] dark:text-[#e9f1eb] sm:left-6"
        >
          {lang === 'en' ? 'Need a hand?' : 'Naweza kusaidia?'}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setBubble(false);
        }}
        aria-label={open ? 'Close help chat' : 'Open help chat'}
        aria-expanded={open}
        className="fixed bottom-5 left-5 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-green-600 shadow-2xl transition hover:bg-green-700 hover:scale-105 active:scale-95 dark:bg-lime-400 dark:hover:bg-lime-300 sm:bottom-6 sm:left-6"
      >
        {open ? <X size={22} className="text-white dark:text-[#0b1712]" /> : <RobotAvatar size={44} waving mood={faceMood} />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Msaidizi"
          className="fixed bottom-24 left-5 z-50 flex h-[min(560px,70vh)] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#11211a] sm:left-6"
        >
          <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-3 dark:border-white/10">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-green-50 dark:bg-lime-400/15">
              <RobotAvatar size={30} talking={speaking} mood={faceMood} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-slate-800 dark:text-[#e9f1eb]">Msaidizi</p>
              <p className="truncate text-xs text-slate-500 dark:text-[#8fa596]">
                {thinking ? (lang === 'en' ? 'thinking…' : 'nafikiri…') : lang === 'en' ? 'Ask how to do anything' : 'Uliza jinsi ya kufanya chochote'}
              </p>
            </div>
            {speechOk && (
              <button
                type="button"
                onClick={toggleAutoRead}
                aria-pressed={autoRead}
                aria-label={autoRead ? 'Turn off reading answers aloud' : 'Read every answer aloud'}
                title={autoRead ? (lang === 'en' ? 'Reading aloud: on' : 'Kusoma kwa sauti: imewashwa') : lang === 'en' ? 'Reading aloud: off' : 'Kusoma kwa sauti: imezimwa'}
                className={clsx(
                  'flex h-8 w-8 flex-none items-center justify-center rounded-lg',
                  autoRead ? 'bg-green-600 text-white dark:bg-lime-400 dark:text-[#0b1712]' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-[#8fa596]'
                )}
              >
                {autoRead ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
            )}
            <div className="flex flex-none items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06]">
              {(['en', 'sw'] as Lang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={clsx(
                    'rounded-md px-2 py-1 text-xs font-bold',
                    lang === l ? 'bg-white text-slate-800 shadow-sm dark:bg-[#1c2a23] dark:text-lime-300' : 'text-slate-400 dark:text-[#8fa596]'
                  )}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <div ref={box} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {msgs.map((m) => (
              <div key={m.id}>
                <Bubble from={m.from}>
                  <span className="whitespace-pre-line">{m.text}</span>
                  {m.steps && m.steps.length > 0 && (
                    <ol className="mt-2 list-decimal space-y-1 pl-4">
                      {m.steps.map((s, j) => (
                        <li key={j}>{s}</li>
                      ))}
                    </ol>
                  )}
                  {m.page && (
                    <Link
                      to={m.page.href}
                      onClick={() => setOpen(false)}
                      className="mt-2 flex w-fit items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white dark:bg-lime-400 dark:text-[#0b1712]"
                    >
                      {lang === 'en' ? 'Open' : 'Fungua'} {m.page.label} <ArrowRight size={13} />
                    </Link>
                  )}
                  {m.offerRequest && !m.requested && (
                    <button
                      type="button"
                      onClick={() => sendToDeveloper(m.id, m.offerRequest!)}
                      className="mt-2 block rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white dark:bg-lime-400 dark:text-[#0b1712]"
                    >
                      {lang === 'en' ? 'Yes, send to developer' : 'Ndiyo, mtumie msanidi'}
                    </button>
                  )}
                  {m.from === 'bot' && speechOk && (
                    <button
                      type="button"
                      onClick={() => speak(m.text + (m.steps ? ' ' + m.steps.join('. ') : ''))}
                      aria-label={lang === 'en' ? 'Read this answer aloud' : 'Soma jibu hili kwa sauti'}
                      className="mt-1.5 flex items-center gap-1 text-xs text-slate-400 hover:text-green-700 dark:text-[#8fa596] dark:hover:text-lime-300"
                    >
                      <Volume2 size={13} /> {lang === 'en' ? 'Listen' : 'Sikiliza'}
                    </button>
                  )}
                </Bubble>
                {m.id === lastBotId && m.chips && m.chips.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.chips.map((id) => {
                      const f = byId(id);
                      if (!f) return null;
                      const here = topicForPath(pathname)?.id === id && m.id === msgs[0]?.id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => ask(f)}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-[#d2dbd5] dark:hover:bg-white/5"
                        >
                          {here ? (lang === 'en' ? 'Help with this page' : 'Msaada wa ukurasa huu') : f.q[lang]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <Bubble from="bot">
                <span className="inline-flex gap-1" aria-label="typing">
                  <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                  <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                  <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                </span>
              </Bubble>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-100 px-3 pb-3 pt-2.5 dark:border-white/10">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={listening ? (lang === 'en' ? 'Listening…' : 'Nasikiliza…') : lang === 'en' ? 'Type a question…' : 'Andika swali…'}
              aria-label={lang === 'en' ? 'Your question' : 'Swali lako'}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-[#e9f1eb]"
            />
            {micOk && (
              <button
                type="button"
                onClick={startListening}
                aria-label={lang === 'en' ? 'Ask by voice' : 'Uliza kwa sauti'}
                className={clsx(
                  'flex h-9 w-9 flex-none items-center justify-center rounded-xl',
                  listening ? 'animate-pulse bg-red-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-[#d2dbd5]'
                )}
              >
                <Mic size={16} />
              </button>
            )}
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim() || thinking}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-green-600 text-white disabled:opacity-50 dark:bg-lime-400 dark:text-[#0b1712]"
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


// "How is my business doing?": this month against last month, from the same monthly overview the Business Growth page shows.
function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) / Math.abs(before)) * 100;
}
function buildCompareAnswer(cur: GrowthOverviewMonth, prev: GrowthOverviewMonth | undefined, lang: Lang): string {
  const label = formatMonthLabel(cur.month, lang);
  const net = cur.metrics.netProfit;
  const head =
    lang === 'en'
      ? `${label}: sales ${tzs(cur.metrics.revenue)} from ${cur.metrics.salesCount} sales, expenses ${tzs(cur.metrics.expenses)}, ${net >= 0 ? 'profit' : 'loss'} ${tzs(Math.abs(net))}.`
      : `${label}: mauzo ${tzs(cur.metrics.revenue)} kutoka mauzo ${cur.metrics.salesCount}, matumizi ${tzs(cur.metrics.expenses)}, ${net >= 0 ? 'faida' : 'hasara'} ${tzs(Math.abs(net))}.`;
  if (!prev || prev.verdict === 'no_data') return head;
  const prevLabel = formatMonthLabel(prev.month, lang);
  const rev = pctChange(cur.metrics.revenue, prev.metrics.revenue);
  const prof = pctChange(net, prev.metrics.netProfit);
  const word = (v: number, up: string, down: string) => (v >= 0 ? up : down);
  const partial = cur.isPartial
    ? lang === 'en'
      ? ' This month is not finished yet, so the comparison will move.'
      : ' Mwezi huu haujaisha, kwa hiyo ulinganisho utabadilika.'
    : '';
  const parts: string[] = [];
  if (rev !== null)
    parts.push(
      lang === 'en'
        ? `Sales are ${Math.abs(rev).toFixed(0)}% ${word(rev, 'higher', 'lower')} than ${prevLabel}.`
        : `Mauzo ${word(rev, 'yamepanda', 'yameshuka')} kwa asilimia ${Math.abs(rev).toFixed(0)} kuliko ${prevLabel}.`
    );
  if (prof !== null)
    parts.push(
      lang === 'en'
        ? `The net result is ${Math.abs(prof).toFixed(0)}% ${word(prof, 'better', 'worse')}.`
        : `Matokeo ya mwisho ni ${word(prof, 'bora', 'mabaya')} kwa asilimia ${Math.abs(prof).toFixed(0)}.`
    );
  return [head, ...parts].join(' ') + partial;
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
