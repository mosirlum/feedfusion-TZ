import type { Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import PDFDocument from 'pdfkit';
import type { NarrativeReport, ChartPoint } from './narrativeReport.service';

/**
 * Narrative Business Report — PDF layout (2026-09-13, CLAUDE.md #64;
 * visual redesign + print-flow change 2026-09-13, CLAUDE.md #64 follow-up).
 *
 * IMPORTANT — cannot be installed or run in this sandbox: `pdfkit` (and
 * `@types/pdfkit`) are new dependencies this file needs, and every attempt
 * to `npm install` anything new in this cloud sandbox fails with a hard
 * `403 Forbidden` from the npm registry (confirmed against a totally
 * unrelated scratch package too, so it's not this project's lockfile —
 * the sandbox itself cannot reach the registry for installs at all).
 * Fetching a custom web font to embed (Inter/Manrope, matching the app's
 * own on-screen typography) was also attempted and blocked the same way —
 * both fonts.googleapis.com and a raw GitHub font file returned 403 from
 * this sandbox's outbound proxy. So this redesign works only with pdfkit's
 * 14 built-in standard PDF fonts (Helvetica family, no embedding needed —
 * every PDF reader ships them), leaning on layout, color, and hierarchy
 * rather than custom type to read as "data analysis" quality. This file
 * has only been checked with an isolated `tsc` pass with "Cannot find
 * module 'pdfkit'" filtered out — verifies this file's own control flow
 * but cannot verify pdfkit's real drawing output. The owner already ran
 * the first version of this end-to-end successfully (confirmed via a real
 * generated PDF), so this redesign is a real second pass at something
 * proven to run, not an untested first attempt.
 *
 * Layout: letterhead -> title -> Executive Summary -> a 4-tile KPI strip
 * (mirrors the on-screen Sales tab's stat cards) -> a revenue-over-time
 * line chart (now with a y-axis scale, gridlines, area fill, and point
 * markers — the plain unlabeled zigzag line was exactly what the owner
 * flagged as looking unfinished) -> Sales Performance narrative ->
 * horizontal bar charts (rounded bars, zebra striping, bold value labels)
 * for Revenue by Category, Top Products, and Staff Performance -> Cash
 * Control and Stock Levels as narrative/bullet lists (no chart — they're
 * about specific variances/items, not a magnitude comparison) -> a
 * highlighted Key Insights & Recommendations box to close. Every page gets
 * a footer with the business name and a page number.
 *
 * pdfkit auto-paginates flowing text (`doc.text(...)`) but does NOT
 * paginate hand-drawn vector shapes (rects/lines for the charts/cards) —
 * the exact lesson CLAUDE.md #63 already learned the hard way for the
 * browser's print CSS. `ensureSpace()` below is this module's equivalent:
 * every chart/card checks how tall it will be against the remaining space
 * on the current page and calls `doc.addPage()` first if it won't fit.
 */

const PAGE_MARGIN = 50;
const GREEN = '#3B6D11';
const GREEN_DARK = '#27500A';
const BLUE = '#185FA5';
const INK = '#1a1a1a';
const MUTED = '#64748b';
const GRID = '#e2e8f0';
const CARD_BORDER = '#e6e9e3';
const SURFACE = '#FAFBF8';
const LIGHT_GREEN_BG = '#F6FAF1';
const BAD = '#B91C1C';

function ensureSpace(doc: PDFKit.PDFDocument, height: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) {
    doc.addPage();
  }
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

// Section headings get a small colored accent bar instead of a full-width
// rule — reads more like a report's own section marker than a plain
// underline, and is cheap to draw (one filled rect) without needing a
// custom font.
function sectionHeading(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 34);
  doc.moveDown(0.7);
  const y = doc.y;
  doc.rect(doc.page.margins.left, y + 2, 3.5, 13).fill(GREEN);
  doc
    .font('Helvetica-Bold')
    .fontSize(12.5)
    .fillColor(GREEN_DARK)
    .text(text, doc.page.margins.left + 12, y, { continued: false });
  doc.moveDown(0.45);
  doc.font('Helvetica').fillColor(INK).fontSize(10.5);
}

function paragraphs(doc: PDFKit.PDFDocument, paras: string[]) {
  for (const p of paras) {
    ensureSpace(doc, 30);
    doc.font('Helvetica').fillColor(INK).fontSize(10.5).text(p, { align: 'left', lineGap: 3.5 });
    doc.moveDown(0.45);
  }
}

// A plain bullet list — used for Stock Levels' item call-outs, which used
// to read as one long comma-joined sentence; a short list of specific
// items is easier to scan and looks more like a real report's flagged-item
// list.
function bulletList(doc: PDFKit.PDFDocument, items: string[]) {
  for (const item of items) {
    ensureSpace(doc, 20);
    const y = doc.y;
    doc.font('Helvetica').fillColor(GREEN).fontSize(10.5).text('•', doc.page.margins.left, y, { continued: false, width: 12 });
    doc
      .font('Helvetica')
      .fillColor(INK)
      .fontSize(10.5)
      .text(item, doc.page.margins.left + 14, y, { width: contentWidth(doc) - 14, lineGap: 2.5 });
    doc.moveDown(0.25);
  }
}

function tzs(n: number): string {
  return `TZS ${Math.round(n).toLocaleString('en-TZ')}`;
}

// Compact axis-label form ("750K", "1.2M") — a y-axis needs a scale, not
// full currency strings, or the labels would crowd out the plot itself.
function abbreviate(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1000)}K`;
  return `${Math.round(n)}`;
}

function drawCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number) {
  doc.roundedRect(x, y, width, height, 6).lineWidth(1).fillAndStroke(SURFACE, CARD_BORDER);
}

interface KpiTile {
  label: string;
  value: string;
  changeText: string;
  changeGood: boolean | null; // null = neutral (e.g. "no prior period")
}

function pctLabel(p: number | null, goodWhenUp: boolean): { text: string; good: boolean | null } {
  if (p === null) return { text: 'No prior period to compare', good: null };
  const up = p >= 0;
  const good = goodWhenUp ? up : !up;
  return { text: `${up ? '+' : ''}${p.toFixed(1)}% vs previous period`, good };
}

// KPI tile strip (2026-09-13, CLAUDE.md #64 follow-up) — the owner asked
// for the report to "look like data analysis" rather than plain paragraphs;
// this mirrors the on-screen Sales tab's own stat cards (revenue,
// transactions, discounts, voided — each with its vs-previous-period trend)
// as a small dashboard-style row before the narrative gets into detail.
function drawKpiTiles(doc: PDFKit.PDFDocument, tiles: KpiTile[]) {
  const width = contentWidth(doc);
  const gap = 10;
  const tileWidth = (width - gap * (tiles.length - 1)) / tiles.length;
  const tileHeight = 56;
  ensureSpace(doc, tileHeight + 16);
  const startX = doc.page.margins.left;
  const startY = doc.y;

  tiles.forEach((t, i) => {
    const x = startX + i * (tileWidth + gap);
    drawCard(doc, x, startY, tileWidth, tileHeight);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(t.label.toUpperCase(), x + 10, startY + 9, { width: tileWidth - 20, characterSpacing: 0.3 });
    doc.font('Helvetica-Bold').fontSize(14.5).fillColor(INK).text(t.value, x + 10, startY + 21, { width: tileWidth - 20 });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(t.changeGood === null ? MUTED : t.changeGood ? GREEN_DARK : BAD)
      .text(t.changeText, x + 10, startY + 40, { width: tileWidth - 20 });
  });

  doc.y = startY + tileHeight + 16;
  doc.x = startX;
}

// Revenue-over-time line chart — redesigned (2026-09-13, CLAUDE.md #64
// follow-up) after the owner flagged the first version's charts as looking
// unfinished ("font graphs they looks so bad"). The original had no y-axis
// scale, no gridlines, and no point markers — just a bare line, which for
// a period with activity on only one or two days rendered as a stray
// triangle with nothing to anchor it. This version adds: a bordered card
// background, horizontal gridlines with abbreviated TZS labels (0/25/50/
// 75/100% of the period max), a light area fill under the line, and a
// filled point marker on every day (not just the ones with data) so the
// shape reads as a real daily time series rather than a sketch.
function drawLineChart(doc: PDFKit.PDFDocument, series: Array<{ date: string; revenue: number }>) {
  if (series.length === 0) return;
  const width = contentWidth(doc);
  const cardHeight = 190;
  ensureSpace(doc, cardHeight + 14);

  const cardX = doc.page.margins.left;
  const cardY = doc.y;
  drawCard(doc, cardX, cardY, width, cardHeight);

  const padding = { top: 16, right: 18, bottom: 26, left: 46 };
  const plotX = cardX + padding.left;
  const plotY = cardY + padding.top;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = cardHeight - padding.top - padding.bottom;
  const max = Math.max(...series.map((d) => d.revenue), 1);
  const n = series.length;

  // Gridlines + y-axis labels at 0/25/50/75/100% of the max.
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = (max / steps) * s;
    const y = plotY + plotHeight - (v / max) * plotHeight;
    doc
      .moveTo(plotX, y)
      .lineTo(plotX + plotWidth, y)
      .strokeColor(GRID)
      .lineWidth(0.75)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED)
      .text(abbreviate(v), cardX + 6, y - 3, { width: padding.left - 12, align: 'right' });
  }

  const xFor = (i: number) => (n === 1 ? plotX + plotWidth / 2 : plotX + (i / (n - 1)) * plotWidth);
  const yFor = (v: number) => plotY + plotHeight - (v / max) * plotHeight;

  // Area fill under the line, then the line itself on top, then a marker
  // dot on every point — in that order so nothing later gets painted over.
  doc.moveTo(xFor(0), plotY + plotHeight);
  series.forEach((d, i) => doc.lineTo(xFor(i), yFor(d.revenue)));
  doc.lineTo(xFor(n - 1), plotY + plotHeight);
  doc.closePath();
  doc.fillOpacity(0.14).fillColor(GREEN).fill();
  doc.fillOpacity(1);

  doc.strokeColor(GREEN).lineWidth(1.75);
  series.forEach((d, i) => {
    if (i === 0) doc.moveTo(xFor(i), yFor(d.revenue));
    else doc.lineTo(xFor(i), yFor(d.revenue));
  });
  doc.stroke();

  series.forEach((d, i) => {
    const x = xFor(i);
    const y = yFor(d.revenue);
    doc.circle(x, y, 2.75).fillColor('#ffffff').fill();
    doc.circle(x, y, 2.75).lineWidth(1.25).strokeColor(GREEN).stroke();
  });

  // A handful of x-axis date labels: first, last, and up to 3 evenly spaced
  // in between — never one per day (CLAUDE.md #62 already learned this
  // lesson for the on-screen chart).
  const labelCount = Math.min(5, n);
  const labelIndices = new Set<number>();
  for (let k = 0; k < labelCount; k++) {
    labelIndices.add(Math.round((k / Math.max(labelCount - 1, 1)) * (n - 1)));
  }
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
  labelIndices.forEach((i) => {
    const d = series[i];
    const label = new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const x = xFor(i);
    const anchor = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
    const textWidth = 60;
    const textX = anchor === 'left' ? x : anchor === 'right' ? x - textWidth : x - textWidth / 2;
    doc.text(label, textX, plotY + plotHeight + 8, { width: textWidth, align: anchor as 'left' | 'right' | 'center' });
  });

  doc.y = cardY + cardHeight + 14;
  doc.x = cardX;
}

// Horizontal bar chart, redesigned alongside the line chart above: a
// bordered card, rounded bar ends, faint zebra striping so a 5-8 row list
// stays easy to scan, and bold ink-colored value labels (the original's
// muted-gray values read as an afterthought next to the bold green bars).
function drawBarChart(doc: PDFKit.PDFDocument, points: ChartPoint[], opts: { valueFormatter: (n: number) => string }) {
  if (points.length === 0) return;
  const width = contentWidth(doc);
  const rowHeight = 24;
  const padding = 14;
  const cardHeight = points.length * rowHeight + padding * 2;
  ensureSpace(doc, cardHeight + 14);

  const cardX = doc.page.margins.left;
  const cardY = doc.y;
  drawCard(doc, cardX, cardY, width, cardHeight);

  const labelWidth = 145;
  const valueWidth = 90;
  const barAreaX = cardX + 14 + labelWidth;
  const barAreaWidth = width - 28 - labelWidth - valueWidth;
  const max = Math.max(...points.map((p) => p.value), 1);

  points.forEach((p, i) => {
    const y = cardY + padding + i * rowHeight;
    if (i % 2 === 1) {
      doc.rect(cardX + 4, y - 2, width - 8, rowHeight).fillColor('#F2F5EF').fill();
    }
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(INK)
      .text(p.label, cardX + 14, y + 5, { width: labelWidth - 8, ellipsis: true });

    const barWidth = Math.max((p.value / max) * barAreaWidth, 6);
    doc.roundedRect(barAreaX, y + 3, barAreaWidth, rowHeight - 12, 4).fillColor(GRID).fill();
    doc.roundedRect(barAreaX, y + 3, barWidth, rowHeight - 12, 4).fillColor(GREEN).fill();

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(INK)
      .text(opts.valueFormatter(p.value), barAreaX + barAreaWidth + 8, y + 5, { width: valueWidth - 8, align: 'right' });
  });

  doc.y = cardY + cardHeight + 14;
  doc.x = cardX;
}

// Key Insights & Recommendations box — height is measured from the actual
// wrapped text (via doc.heightOfString) rather than guessed from a fixed
// per-line estimate. Real bug in the first version: a fixed "16pt per
// insight" estimate assumed every insight fit on one line, but most wrap to
// two, so the box was sized too short for its own content on any report
// with a handful of insights — fixed here by measuring for real before
// drawing the box.
function drawInsightsBox(doc: PDFKit.PDFDocument, insights: string[]) {
  const width = contentWidth(doc);
  const innerWidth = width - 32;
  const titleHeight = 30;
  const bulletGap = 6;
  doc.font('Helvetica').fontSize(9.5);
  const bulletHeights = insights.map((text) => doc.heightOfString(text, { width: innerWidth - 14, lineGap: 2 }));
  const bodyHeight = bulletHeights.reduce((sum, h) => sum + h + bulletGap, 0);
  const boxHeight = titleHeight + bodyHeight + 16;

  ensureSpace(doc, boxHeight + 20);
  doc.moveDown(0.6);
  const boxX = doc.page.margins.left;
  const boxY = doc.y;
  doc.roundedRect(boxX, boxY, width, boxHeight, 6).fillColor(LIGHT_GREEN_BG).fill();

  doc.font('Helvetica-Bold').fontSize(12.5).fillColor(GREEN_DARK).text('Key Insights & Recommendations', boxX + 16, boxY + 14, { width: innerWidth });

  let y = boxY + titleHeight + 6;
  insights.forEach((text, i) => {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREEN).text('•', boxX + 16, y, { width: 10 });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(text, boxX + 30, y, { width: innerWidth - 14, lineGap: 2 });
    y += bulletHeights[i] + bulletGap;
  });

  doc.y = boxY + boxHeight + 10;
  doc.x = boxX;
}

// Footer with page numbers — drawn once at the very end over every buffered
// page (requires `bufferPages: true` on the document), a small but real
// "looks like a real report" touch the owner asked for.
//
// Real bug fixed (2026-09-13, found from the owner's own generated PDF: a
// real 3-page report came out as those 3 pages followed by 6 trailing
// blank ones — 2 extra blank pages per real page, matching exactly 2
// footer `.text()` calls per page). Root cause: `y` here was deliberately
// placed BELOW the page's own bottom margin (in the margin gutter, where a
// footer belongs) — but that's exactly what pdfkit's own automatic
// pagination watches for. Every `.text()` call checks whether it's drawing
// past the page's usable (margin-bound) area, and if so, silently inserts
// a brand-new page and continues there instead of raising an error — so
// each footer call was quietly starting a fresh blank page rather than
// drawing in the gutter of the current one. Fix: temporarily zero this
// page's `margins.bottom` before drawing the footer, so pdfkit treats the
// full page height as usable and draws the text in place; restored
// immediately after so nothing downstream sees the wrong margin.
function drawFooters(doc: PDFKit.PDFDocument, businessName: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - bottomMargin + 16;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(businessName, doc.page.margins.left, y, { width: 250, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - doc.page.margins.right - 150, y, {
        width: 150,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottomMargin;
  }
}

export function streamNarrativePdf(report: NarrativeReport, res: Response) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
  const filename = `Business-Report-${report.from}-to-${report.to}.pdf`;
  // Document title metadata — some PDF viewers (Chrome's built-in viewer
  // included) use this to suggest a filename when the reader saves/prints
  // from an opened tab rather than a direct download, which is now the
  // primary way this report reaches the owner (see ReportsPage.tsx's
  // "Generate Report" button — 2026-09-13 follow-up: opens the PDF in a
  // new tab for the owner to view/print/save from the browser's own PDF
  // toolbar, instead of forcing an immediate silent download).
  doc.info.Title = `${report.business.name} - Business Report (${report.periodLabel})`;
  doc.info.Author = report.business.name;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  // Letterhead — a thin two-tone band (green/blue, echoing the app's own
  // sidebar gradient colors, CLAUDE.md #61) above the business name.
  const bandWidth = contentWidth(doc);
  doc.rect(doc.page.margins.left, doc.y, bandWidth / 2, 3).fill(GREEN);
  doc.rect(doc.page.margins.left + bandWidth / 2, doc.y, bandWidth / 2, 3).fill(BLUE);
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').fontSize(17).fillColor(GREEN_DARK).text(report.business.name, { continued: false });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const contactLine = [report.business.address, report.business.phone, report.business.email, report.business.tin ? `TIN: ${report.business.tin}` : null]
    .filter(Boolean)
    .join('   ·   ');
  if (contactLine) doc.text(contactLine);
  doc.moveDown(0.9);

  doc.font('Helvetica').fontSize(8).fillColor(BLUE).text('BUSINESS REPORT', { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(21).fillColor(INK).text(report.periodLabel, { continued: false });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(`Generated ${new Date(report.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`);
  doc.moveDown(1.1);

  sectionHeading(doc, 'Executive Summary');
  paragraphs(doc, report.executiveSummary);
  doc.moveDown(0.2);

  const revTrend = pctLabel(report.kpis.totalRevenueChangePct, true);
  const txTrend = pctLabel(report.kpis.transactionCountChangePct, true);
  const discTrend = pctLabel(report.kpis.totalDiscountChangePct, false);
  const voidTrend = pctLabel(report.kpis.voidedCountChangePct, false);
  drawKpiTiles(doc, [
    { label: 'Total Revenue', value: tzs(report.kpis.totalRevenue), changeText: revTrend.text, changeGood: revTrend.good },
    { label: 'Transactions', value: String(report.kpis.transactionCount), changeText: txTrend.text, changeGood: txTrend.good },
    { label: 'Discounts Given', value: tzs(report.kpis.totalDiscount), changeText: discTrend.text, changeGood: discTrend.good },
    { label: 'Voided Sales', value: String(report.kpis.voidedCount), changeText: voidTrend.text, changeGood: voidTrend.good },
  ]);

  if (report.charts.dailyRevenue.length > 0) {
    sectionHeading(doc, 'Revenue Trend');
    drawLineChart(doc, report.charts.dailyRevenue);
  }

  for (const section of report.sections) {
    sectionHeading(doc, section.heading);
    if (section.key === 'category' && report.charts.revenueByCategory.length > 0) {
      drawBarChart(doc, report.charts.revenueByCategory, { valueFormatter: tzs });
    }
    if (section.key === 'products' && report.charts.topProducts.length > 0) {
      drawBarChart(doc, report.charts.topProducts, { valueFormatter: tzs });
    }
    if (section.key === 'staff' && report.charts.revenueByStaff.length > 0) {
      drawBarChart(doc, report.charts.revenueByStaff, { valueFormatter: tzs });
    }
    if (section.key === 'stock' && section.paragraphs.length > 1) {
      // The first paragraph(s) are the "N product(s) are out of stock/
      // running low: ..." item-naming sentences, and the last is always
      // the fixed "Restocking these soon..." closing line (see
      // narrativeReport.service.ts's buildLowStockSection) — render the
      // item-naming ones as a scannable bullet list and the closing line
      // as normal prose underneath. When there's just the one "nothing is
      // low" sentence, it falls through to the plain paragraph path below.
      bulletList(doc, section.paragraphs.slice(0, -1));
      paragraphs(doc, [section.paragraphs[section.paragraphs.length - 1]]);
    } else {
      paragraphs(doc, section.paragraphs);
    }
  }

  drawInsightsBox(doc, report.insights);

  drawFooters(doc, report.business.name);

  doc.end();
}
