import { productsApi, reportsApi, salesApi } from './api';
import { tzs } from './format';

/**
 * What Feedy can DO, not just explain (CLAUDE.md #104). Everything here is
 * rule-based (no paid AI): it reads what the person typed or said, in English
 * or Swahili, works out the period ("last week", "jana", "mwezi uliopita")
 * and what they want (a summary, invoices, a report, low stock...), then reads
 * the same live endpoints the pages use. It only READS and OPENS things; it
 * never records a sale, expense or stock change on its own.
 */
export type Lang = 'en' | 'sw';

export interface Period {
  from: string;
  to: string;
  label: Record<Lang, string>;
}

export type Intent =
  | { kind: 'report'; period: Period; print: boolean }
  | { kind: 'invoices'; period: Period }
  | { kind: 'summary'; period: Period; text: string }
  | { kind: 'lowstock' }
  | { kind: 'topproducts'; period: Period }
  | { kind: 'goto'; href: string; label: string };

export interface ChatAction {
  label: string;
  href?: string;
  report?: { from: string; to: string };
}

export interface ActionResult {
  text: string;
  actions?: ChatAction[];
  /** Hand the report over to the chat to generate and show. */
  report?: { from: string; to: string; print: boolean };
  mood?: 'happy' | 'sad';
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const shortDay = (s: string, lang: Lang) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'sw' ? 'sw-TZ' : 'en-GB', { day: 'numeric', month: 'short' });
};
const rangeText = (from: string, to: string, lang: Lang) => (from === to ? shortDay(from, lang) : `${shortDay(from, lang)} – ${shortDay(to, lang)}`);

const MONTHS: Array<[RegExp, number]> = [
  [/\bjan(uary|uari)?\b/, 0],
  [/\bfeb(ruary|ruari)?\b/, 1],
  [/\b(march|machi)\b/, 2],
  [/\bapr(il|ili)?\b/, 3],
  [/\b(mei|(?:of|in|for) may)\b/, 4],
  [/\b(june|juni)\b/, 5],
  [/\b(july|julai)\b/, 6],
  [/\b(aug(ust)?|agosti)\b/, 7],
  [/\bsep(t|tember|temba)?\b/, 8],
  [/\b(oct(ober)?|oktoba)\b/, 9],
  [/\b(nov(ember)?|novemba)\b/, 10],
  [/\b(dec(ember)?|desemba)\b/, 11],
];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];

/** "yesterday", "last week", "mwezi uliopita", "June"... → a real date range. */
export function parsePeriod(raw: string, now = new Date()): Period | null {
  const t = raw.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/last month|previous month|mwezi (uliopita|ulopita|jana|wa jana|uliopo?ta)/.test(t)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: iso(start), to: iso(end), label: { en: `last month (${MONTH_EN[start.getMonth()]})`, sw: `mwezi uliopita (${MONTH_SW[start.getMonth()]})` } };
  }
  if (/this month|mwezi huu|mwezi wa sasa/.test(t)) {
    return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today), label: { en: 'this month', sw: 'mwezi huu' } };
  }
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  if (/last week|previous week|wiki (iliyopita|iliyopita|ilopita|jana|iliyoisha)/.test(t)) {
    const s = addDays(monday, -7);
    return { from: iso(s), to: iso(addDays(s, 6)), label: { en: 'last week', sw: 'wiki iliyopita' } };
  }
  if (/this week|wiki hii|wiki ya sasa/.test(t)) {
    return { from: iso(monday), to: iso(today), label: { en: 'this week', sw: 'wiki hii' } };
  }
  const days = t.match(/(?:last|past)\s+(\d{1,3})\s+days|siku\s+(\d{1,3})\s+(?:zilizopita|zilizopita|zilopita|za nyuma)/);
  if (days) {
    const n = Math.min(Number(days[1] ?? days[2]), 366);
    return { from: iso(addDays(today, -(n - 1))), to: iso(today), label: { en: `the last ${n} days`, sw: `siku ${n} zilizopita` } };
  }
  if (/day before yesterday|juzi/.test(t)) {
    const d = iso(addDays(today, -2));
    return { from: d, to: d, label: { en: 'the day before yesterday', sw: 'juzi' } };
  }
  if (/yesterday|\bjana\b/.test(t)) {
    const d = iso(addDays(today, -1));
    return { from: d, to: d, label: { en: 'yesterday', sw: 'jana' } };
  }
  if (/\btoday\b|\bleo\b|today's|ya leo/.test(t)) {
    return { from: iso(today), to: iso(today), label: { en: 'today', sw: 'leo' } };
  }
  for (const [re, idx] of MONTHS) {
    if (re.test(t)) {
      const year = idx > today.getMonth() ? today.getFullYear() - 1 : today.getFullYear();
      const end = new Date(year, idx + 1, 0);
      const to = end > today ? today : end;
      return { from: iso(new Date(year, idx, 1)), to: iso(to), label: { en: `${MONTH_EN[idx]} ${year}`, sw: `${MONTH_SW[idx]} ${year}` } };
    }
  }
  return null;
}

const PAGES: Array<[RegExp, string, string]> = [
  [/\b(pos|new sale|mauzo mapya|point of sale)\b/, '/pos', 'New Sale'],
  [/sales history|historia ya mauzo|invoices/, '/sales-history', 'Sales History'],
  [/\b(reports?|ripoti)\b/, '/reports', 'Reports'],
  [/\b(expenses?|matumizi)\b/, '/expenses', 'Expenses'],
  [/\b(inventory|stock|bidhaa zilizopo|hesabu ya stoo)\b/, '/inventory', 'Inventory'],
  [/\b(products?|bidhaa)\b/, '/products', 'Products'],
  [/\b(customers?|wateja)\b/, '/customers', 'Customers'],
  [/\b(purchases?|manunuzi)\b/, '/purchases', 'Purchases'],
  [/\b(suppliers?|wasambazaji)\b/, '/suppliers', 'Suppliers'],
  [/business growth|ukuaji/, '/business-growth', 'Business Growth'],
  [/\b(dashboard|mwanzo)\b/, '/dashboard', 'Dashboard'],
];

/** Work out what the person wants done. Returns null when it is a normal "how do I…" question. */
export function detectIntent(raw: string): Intent | null {
  const t = raw.toLowerCase().trim();
  if (!t) return null;
  const period = parsePeriod(t);
  const howTo = /\bhow (do|can|to|should)\b|jinsi ya|nawezaje|naweza vipi|ninawezaje|what is|nini maana/.test(t);
  if (howTo && !period) return null;

  const wantsDoc = /generate|create|make|print|download|pdf|give me|show me|i need|get me|tengeneza|toa|nipe|chapa|pakua|nataka|nahitaji|onyesha|leta/.test(t);

  if (/invoice|receipt|risiti|ankara|fatura/.test(t) && (period || wantsDoc)) {
    return { kind: 'invoices', period: period ?? parsePeriod('today')! };
  }
  if (/\b(report|ripoti|taarifa)\b/.test(t) && (wantsDoc || period)) {
    return { kind: 'report', period: period ?? parsePeriod('this month')!, print: /print|chapa/.test(t) };
  }
  if (/low stock|running (out|low)|out of stock|inaisha|zinaisha|zinazoisha|zinazokwisha|kuisha|imeisha|zimeisha|stoo ndogo|zinakwisha|zinakaribia kuisha/.test(t)) {
    return { kind: 'lowstock' };
  }
  if (/(top|best|most)[\s-]*(selling|sold|sellers?)|inayouzika|zinazouzika|bidhaa bora|zinazoongoza/.test(t)) {
    return { kind: 'topproducts', period: period ?? parsePeriod('this month')! };
  }
  if (period && /sale|sold|sell|mauzo|nimeuza|umeuza|summary|muhtasari|how (was|were|did)|vipi|performance|turnover|mapato|income/.test(t)) {
    return { kind: 'summary', period, text: t };
  }
  const go = t.match(/^(?:please\s+)?(?:open|go to|take me to|show|nipeleke|fungua|nenda|nipeleke kwenye)\s+(?:the\s+|ukurasa wa\s+)?(.+)$/);
  if (go) {
    const hit = PAGES.find(([re]) => re.test(go[1]));
    if (hit) return { kind: 'goto', href: hit[1], label: hit[2] };
  }
  return null;
}

const pctText = (pct: number | null | undefined, lang: Lang) => {
  if (pct === null || pct === undefined) return '';
  const up = pct >= 0;
  const n = Math.abs(pct).toFixed(0);
  return lang === 'en' ? ` That is ${n}% ${up ? 'more' : 'less'} than the period before.` : ` Hiyo ni asilimia ${n} ${up ? 'zaidi' : 'pungufu'} kuliko kipindi kilichotangulia.`;
};

const ownerOnly = (lang: Lang): ActionResult => ({
  text: lang === 'en' ? 'That is only available to the shop owner.' : 'Hiyo inapatikana kwa mwenye duka pekee.',
  mood: 'sad',
});
const failed = (lang: Lang): ActionResult => ({
  text: lang === 'en' ? 'I could not load that right now. Please try again in a moment.' : 'Imeshindwa kupata taarifa hiyo sasa. Jaribu tena baadaye kidogo.',
  mood: 'sad',
});

export async function runIntent(intent: Intent, lang: Lang, isOwner: boolean): Promise<ActionResult> {
  try {
    switch (intent.kind) {
      case 'goto':
        return {
          text: lang === 'en' ? `Opening ${intent.label}.` : `Nakufungulia ${intent.label}.`,
          actions: [{ label: lang === 'en' ? `Open ${intent.label}` : `Fungua ${intent.label}`, href: intent.href }],
          mood: 'happy',
        };

      case 'report': {
        if (!isOwner) return ownerOnly(lang);
        const { from, to, label } = intent.period;
        return {
          text:
            lang === 'en'
              ? `Preparing the full business report for ${label.en} (${rangeText(from, to, lang)}). It will open for you to read first, then you can Print or Download.`
              : `Naandaa ripoti kamili ya biashara ya ${label.sw} (${rangeText(from, to, lang)}). Itafunguka usome kwanza, kisha unaweza Kuchapa au Kupakua.`,
          report: { from, to, print: intent.print },
        };
      }

      case 'invoices': {
        const { from, to, label } = intent.period;
        const res = await salesApi.list({ from, to, status: 'COMPLETED' });
        const sales = res.data;
        if (!sales.length) {
          return {
            text: lang === 'en' ? `There are no invoices for ${label.en}.` : `Hakuna ankara za ${label.sw}.`,
            mood: 'sad',
          };
        }
        const total = sales.reduce((s, x) => s + Number(x.total), 0);
        const shown = sales.slice(0, 6);
        const actions: ChatAction[] = shown.map((s) => ({
          label: `${s.invoice_number} · ${s.customer_name || (lang === 'en' ? 'Walk-in' : 'Mteja wa kawaida')} · ${tzs(s.total)}`,
          href: `/sales-history?open=${s.id}${sales.length === 1 ? '&print=1' : ''}`,
        }));
        actions.push({
          label: lang === 'en' ? `See all ${sales.length} in Sales History` : `Ona zote ${sales.length} kwenye Historia ya Mauzo`,
          href: `/sales-history?from=${from}&to=${to}`,
        });
        return {
          text:
            lang === 'en'
              ? `Found ${sales.length} invoice${sales.length === 1 ? '' : 's'} for ${label.en}, worth ${tzs(total)} in total. Tap one to open it; the Print button is inside.${sales.length > shown.length ? ` Showing the first ${shown.length}.` : ''}`
              : `Nimepata ankara ${sales.length} za ${label.sw}, jumla ${tzs(total)}. Gusa moja kuifungua; kitufe cha Chapa kiko ndani.${sales.length > shown.length ? ` Zinaonyeshwa ${shown.length} za kwanza.` : ''}`,
          actions,
          mood: 'happy',
        };
      }

      case 'summary': {
        const { from, to, label } = intent.period;
        // A category named in the question ("how much poultry feed today")
        // is answered from product sales + product categories (owner only:
        // the products report is owner-only on the server).
        if (isOwner) {
          const [prodRes, rowsRes] = await Promise.all([productsApi.list(true), reportsApi.products(from, to)]);
          const cats = Array.from(new Set(prodRes.data.map((p) => p.category_name).filter((c): c is string => !!c)));
          const cat = cats.find((c) => intent.text.includes(c.toLowerCase()));
          if (cat) {
            const ids = new Set(prodRes.data.filter((p) => p.category_name === cat).map((p) => p.id));
            const rows = rowsRes.data.filter((r) => ids.has(r.product_id));
            const revenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
            if (!rows.length || revenue === 0) {
              return {
                text: lang === 'en' ? `No ${cat} sales for ${label.en}.` : `Hakuna mauzo ya ${cat} kwa ${label.sw}.`,
                mood: 'sad',
              };
            }
            const best = [...rows].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 3);
            const list = best.map((r) => `${r.product_name} (${tzs(r.revenue)})`).join(', ');
            return {
              text:
                lang === 'en'
                  ? `${cat} sales for ${label.en}: ${tzs(revenue)} from ${rows.length} product${rows.length === 1 ? '' : 's'}. Best: ${list}.`
                  : `Mauzo ya ${cat} kwa ${label.sw}: ${tzs(revenue)} kutoka bidhaa ${rows.length}. Bora zaidi: ${list}.`,
              mood: 'happy',
            };
          }
        }
        const statsRes = await salesApi.stats({ from, to });
        const s = statsRes.data;
        if (!s.transactionCount) {
          return {
            text: lang === 'en' ? `No sales were recorded for ${label.en} (${rangeText(from, to, lang)}).` : `Hakuna mauzo yaliyorekodiwa kwa ${label.sw} (${rangeText(from, to, lang)}).`,
            actions: [{ label: lang === 'en' ? 'Open New Sale' : 'Fungua Mauzo Mapya', href: '/pos' }],
            mood: 'sad',
          };
        }
        let text =
          lang === 'en'
            ? `Sales for ${label.en} (${rangeText(from, to, lang)}): ${tzs(s.totalSales)} from ${s.transactionCount} sale${s.transactionCount === 1 ? '' : 's'}, ${s.itemsSold} item${s.itemsSold === 1 ? '' : 's'} sold.`
            : `Mauzo ya ${label.sw} (${rangeText(from, to, lang)}): ${tzs(s.totalSales)} kutoka mauzo ${s.transactionCount}, bidhaa ${s.itemsSold} zimeuzwa.`;
        text += pctText(s.totalSalesChangePct, lang);
        if (isOwner && s.grossProfit !== undefined) {
          text += lang === 'en' ? ` Gross profit: ${tzs(s.grossProfit)}.` : ` Faida ghafi: ${tzs(s.grossProfit)}.`;
          const top = (await reportsApi.products(from, to)).data
            .slice()
            .sort((a, b) => Number(b.revenue) - Number(a.revenue))
            .slice(0, 3);
          if (top.length) {
            const list = top.map((r) => `${r.product_name} (${tzs(r.revenue)})`).join(', ');
            text += lang === 'en' ? ` Top sellers: ${list}.` : ` Zilizouzika zaidi: ${list}.`;
          }
        }
        return {
          text,
          actions: isOwner
            ? [{ label: lang === 'en' ? `Get the full report for ${label.en}` : `Pata ripoti kamili ya ${label.sw}`, report: { from, to } }]
            : [{ label: lang === 'en' ? 'Open Sales History' : 'Fungua Historia ya Mauzo', href: `/sales-history?from=${from}&to=${to}` }],
          mood: 'happy',
        };
      }

      case 'topproducts': {
        if (!isOwner) return ownerOnly(lang);
        const { from, to, label } = intent.period;
        const rows = (await reportsApi.products(from, to)).data
          .slice()
          .sort((a, b) => Number(b.revenue) - Number(a.revenue))
          .slice(0, 5)
          .filter((r) => Number(r.revenue) > 0);
        if (!rows.length) {
          return { text: lang === 'en' ? `No product sales for ${label.en}.` : `Hakuna mauzo ya bidhaa kwa ${label.sw}.`, mood: 'sad' };
        }
        const list = rows.map((r, i) => `${i + 1}. ${r.product_name} — ${tzs(r.revenue)}`).join('\n');
        return {
          text: (lang === 'en' ? `Best sellers for ${label.en}:\n` : `Bidhaa zilizouzika zaidi kwa ${label.sw}:\n`) + list,
          mood: 'happy',
        };
      }

      case 'lowstock': {
        if (!isOwner) return ownerOnly(lang);
        const rows = (await reportsApi.lowStock()).data;
        if (!rows.length) {
          return { text: lang === 'en' ? 'Good news: nothing is running low right now.' : 'Habari njema: hakuna bidhaa inayokaribia kuisha sasa.', mood: 'happy' };
        }
        const list = rows
          .slice(0, 8)
          .map((r) => `• ${r.name}: ${r.current_stock} ${r.unit}${r.status === 'OUT_OF_STOCK' ? (lang === 'en' ? ' (out)' : ' (imeisha)') : ''}`)
          .join('\n');
        return {
          text:
            (lang === 'en' ? `${rows.length} product${rows.length === 1 ? ' is' : 's are'} low or out of stock:\n` : `Bidhaa ${rows.length} zinakaribia kuisha au zimeisha:\n`) +
            list +
            (rows.length > 8 ? (lang === 'en' ? `\n…and ${rows.length - 8} more.` : `\n…na ${rows.length - 8} zaidi.`) : ''),
          actions: [{ label: lang === 'en' ? 'Open Inventory' : 'Fungua Bidhaa Zilizopo', href: '/inventory' }],
          mood: 'sad',
        };
      }
    }
  } catch {
    return failed(lang);
  }
}
