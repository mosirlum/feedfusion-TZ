import type { Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import ExcelJS from 'exceljs';
import * as reportsService from './reports.service';
import * as settingsService from './settings.service';

/**
 * Sales Excel Report (2026-09-14, CLAUDE.md #68e) — the owner's actual
 * words on the plain "Download CSV" button on the Reports Sales tab:
 * "ndo nlchokuw nakitak na co just normal excel" (that's what I wanted, not
 * just a normal excel) — after seeing a manually-built colored analysis
 * workbook (KPIs, a filterable/colored detail table, a staff/day
 * breakdown) that this session put together by hand in chat from a CSV he
 * exported. He confirmed he wants the app itself to produce that when he
 * clicks Download, not a one-off favor done in chat.
 *
 * IMPORTANT — cannot be installed or run in this sandbox: `exceljs` is a
 * new dependency this file needs, and every attempt to `npm install`
 * anything new in this cloud sandbox fails with a hard `403 Forbidden`
 * from the npm registry — the exact same wall already documented for
 * `pdfkit` (see pdfReport.service.ts's own header comment, and CLAUDE.md).
 * This file has only been checked with an isolated `tsc` pass with
 * "Cannot find module 'exceljs'" filtered out, which verifies this file's
 * own control flow (date handling, the formulas it writes as strings, the
 * conditional-formatting rule shapes) but cannot verify exceljs actually
 * accepts every option object here or that a real Excel opens the result
 * cleanly. **The owner must run `npm install` inside `backend/` on his own
 * machine before this endpoint will work at all** — same next-step as the
 * PDF Reports feature already needed.
 *
 * Scope, decided without going back to the owner (flagged per the
 * project's standing "flag judgment calls" instruction rather than
 * silently deciding): this replaces the Download button on the Sales tab
 * only, not the other 7 Reports tabs (Products, Discounts, Cash,
 * Purchases, Users, Stock, Low Stock) — the owner's complaint and the
 * manual example he approved were both specifically about Sales. Those
 * other tabs keep their existing plain-CSV download untouched; extending
 * this same treatment to them is a natural, separate follow-up if he asks.
 *
 * Also a real capability gap versus the manual version done in chat: that
 * one used Python's openpyxl, which can embed native Excel pie/bar chart
 * objects. `exceljs` (the only maintained xlsx-writing library available
 * for this Node backend) cannot create native chart objects at all — only
 * cell data, formatting, and images. So this version has everything else
 * (KPI cards, a colored + filterable + formula-driven detail table, a
 * staff/day breakdown) but swaps the two charts for data-bar conditional
 * formatting on the breakdown tables — a native, still-visual stand-in
 * that Excel renders without any extra library, rather than a real pie/bar
 * chart. Worth knowing before treating this as a like-for-like replacement
 * of the chat-built example.
 */

const GREEN = 'FF3B6D11';
const GREEN_LIGHT = 'FFE9F2E3';
const BLUE = 'FF185FA5';
const BLUE_LIGHT = 'FFE4EEF7';
const AMBER = 'FFF59E0B';
const AMBER_LIGHT = 'FFFDF3E0';
const RED = 'FFA32D2D';
const SLATE = 'FF475569';
const SLATE_LIGHT = 'FFF1F5F4';
const WHITE = 'FFFFFFFF';
const FONT = 'Arial';
const TZS_FMT = '"TZS "#,##0';

function solid(argb: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } };
}

interface SaleRow {
  id: number;
  invoice_number: string;
  sale_date: string | Date;
  total: string | number;
  total_discount: string | number;
  status: string;
  served_by_name: string;
}

export async function buildSalesExcelWorkbook(fromRaw?: string, toRaw?: string) {
  // Reuses the same validated aggregator the on-screen Sales tab's table
  // uses (reportsApi.sales -> salesReportHandler -> getSalesReport) rather
  // than re-querying the DB directly, so this file can never drift from
  // what the owner sees on screen, and date-range validation (throws
  // HttpError on a missing/invalid from/to) doesn't need re-implementing.
  const { sales } = (await reportsService.getSalesReport(fromRaw, toRaw)) as { sales: SaleRow[] };
  // getSalesReport throws HttpError above if from/to are missing/invalid, so
  // by this point both are guaranteed real ISO date strings.
  const from = fromRaw as string;
  const to = toRaw as string;
  const settings = await settingsService.getSettings();
  const businessName = settings.business_name ?? 'Feed Fusion Tanzania';

  const n = sales.length;
  const firstRow = 2;
  const dataLastRow = 1 + Math.max(n, 1); // keep row 2 reserved even with zero sales, so formulas below point at a non-empty range
  const sorted = [...sales].sort((a, b) => new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime());
  const staffNames = [...new Set(sorted.map((s) => s.served_by_name))].sort();
  const dateKeys = [...new Set(sorted.map((s) => new Date(s.sale_date).toISOString().slice(0, 10)))].sort();
  const totalRevenue = sorted.reduce((sum, s) => sum + Number(s.total), 0);
  const totalDiscount = sorted.reduce((sum, s) => sum + Number(s.total_discount ?? 0), 0);
  const netRevenue = totalRevenue - totalDiscount;
  const largest = sorted.reduce((max, s) => Math.max(max, Number(s.total)), 0);
  const withDiscount = sorted.filter((s) => Number(s.total_discount ?? 0) > 0).length;
  const salesRange = (col: string) => `'Sales Data'!${col}${firstRow}:${col}${dataLastRow}`;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = businessName;
  workbook.created = new Date();

  // -------------------------------------------------------------------
  // Dashboard — created first so it's the workbook's first, active tab.
  // KPI cards + a staff/day breakdown, colored throughout.
  // -------------------------------------------------------------------
  const dash = workbook.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
  dash.mergeCells('A1:L1');
  dash.getCell('A1').value = `${businessName} — Sales Analysis`;
  dash.getCell('A1').font = { name: FONT, bold: true, size: 18, color: { argb: GREEN } };
  dash.getRow(1).height = 26;

  dash.mergeCells('A2:L2');
  dash.getCell('A2').value = `Report range: ${from} to ${to}   |   Source: Reports → Sales tab`;
  dash.getCell('A2').font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };

  dash.mergeCells('A3:L3');
  const callout = dash.getCell('A3');
  callout.value =
    n === 0
      ? 'No sales recorded in this range.'
      : `${n} sale${n === 1 ? '' : 's'} recorded in this range, ${staffNames.length} staff member${staffNames.length === 1 ? '' : 's'}, across ${dateKeys.length} day${dateKeys.length === 1 ? '' : 's'}.`;
  callout.font = { name: FONT, italic: true, size: 9, color: { argb: SLATE } };
  callout.fill = solid(SLATE_LIGHT);
  callout.alignment = { wrapText: true, vertical: 'middle' };
  dash.getRow(3).height = 22;

  function kpiCard(col: number, row0: number, title: string, formula: string, result: number, numFmt: string, fill: string, textColor: string) {
    const c0 = dash.getColumn(col).letter;
    const c1 = dash.getColumn(col + 1).letter;
    dash.mergeCells(`${c0}${row0}:${c1}${row0}`);
    const lab = dash.getCell(row0, col);
    lab.value = title;
    lab.font = { name: FONT, size: 9, bold: true, color: { argb: SLATE } };
    lab.fill = solid(fill);
    lab.alignment = { horizontal: 'center', vertical: 'middle' };
    dash.mergeCells(`${c0}${row0 + 1}:${c1}${row0 + 2}`);
    const val = dash.getCell(row0 + 1, col);
    val.value = { formula, result };
    val.font = { name: FONT, size: 16, bold: true, color: { argb: textColor } };
    val.fill = solid(fill);
    val.numFmt = numFmt;
    val.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  kpiCard(1, 5, 'TOTAL REVENUE', `SUM(${salesRange('E')})`, totalRevenue, TZS_FMT, GREEN_LIGHT, GREEN);
  kpiCard(4, 5, 'TOTAL DISCOUNT GIVEN', `SUM(${salesRange('F')})`, totalDiscount, TZS_FMT, AMBER_LIGHT, AMBER);
  kpiCard(7, 5, 'NET REVENUE', `SUM(${salesRange('G')})`, netRevenue, TZS_FMT, BLUE_LIGHT, BLUE);
  kpiCard(10, 5, 'TRANSACTIONS', `COUNTA(${salesRange('A')})`, n, '0', SLATE_LIGHT, SLATE);
  kpiCard(1, 9, 'AVERAGE SALE VALUE', `IFERROR(AVERAGE(${salesRange('E')}),0)`, n > 0 ? totalRevenue / n : 0, TZS_FMT, GREEN_LIGHT, GREEN);
  kpiCard(4, 9, 'DISCOUNT RATE', `IF(A6=0,0,D6/A6)`, totalRevenue === 0 ? 0 : totalDiscount / totalRevenue, '0.0%', AMBER_LIGHT, AMBER);
  kpiCard(7, 9, 'LARGEST SALE', `IFERROR(MAX(${salesRange('E')}),0)`, largest, TZS_FMT, BLUE_LIGHT, BLUE);
  kpiCard(10, 9, 'SALES WITH A DISCOUNT', `COUNTIF(${salesRange('F')},">0")`, withDiscount, '0', SLATE_LIGHT, SLATE);

  for (let c = 1; c <= 12; c++) dash.getColumn(c).width = 11.5;
  dash.getRow(5).height = 14;
  dash.getRow(9).height = 14;

  // Staff/day mini-tables (values, not formulas — Breakdown tab below has
  // the live formula versions) plus data-bar conditional formatting, the
  // closest native-Excel stand-in for the two charts the chat-built
  // version had: exceljs cannot create real chart objects (see file
  // header comment).
  const tableTitleRow = 13;
  dash.getCell(tableTitleRow, 1).value = 'Revenue by Staff Member';
  dash.getCell(tableTitleRow, 1).font = { name: FONT, bold: true, size: 12, color: { argb: GREEN } };
  dash.getCell(tableTitleRow, 7).value = 'Revenue by Day';
  dash.getCell(tableTitleRow, 7).font = { name: FONT, bold: true, size: 12, color: { argb: GREEN } };

  const dashHeaderRow = tableTitleRow + 1;
  ['Staff', 'Revenue (TZS)', 'Share'].forEach((h, i) => {
    const cell = dash.getCell(dashHeaderRow, 1 + i);
    cell.value = h;
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = solid(BLUE);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  const dashStaffStart = dashHeaderRow + 1;
  (staffNames.length > 0 ? staffNames : ['—']).forEach((name, i) => {
    const r = dashStaffStart + i;
    const rev = sorted.filter((s) => s.served_by_name === name).reduce((sum, s) => sum + Number(s.total), 0);
    dash.getCell(r, 1).value = name;
    dash.getCell(r, 2).value = rev;
    dash.getCell(r, 2).numFmt = TZS_FMT;
    dash.getCell(r, 3).value = totalRevenue === 0 ? 0 : rev / totalRevenue;
    dash.getCell(r, 3).numFmt = '0.0%';
    [1, 2, 3].forEach((c) => {
      dash.getCell(r, c).font = { name: FONT, size: 10 };
      dash.getCell(r, c).alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle' };
    });
  });
  const dashStaffEnd = dashStaffStart + Math.max(staffNames.length, 1) - 1;
  if (staffNames.length > 0) {
    dash.addConditionalFormatting({
      ref: `B${dashStaffStart}:B${dashStaffEnd}`,
      rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: BLUE }, priority: 1 } as any],
    });
  }

  ['Date', 'Revenue (TZS)', 'Transactions'].forEach((h, i) => {
    const cell = dash.getCell(dashHeaderRow, 7 + i);
    cell.value = h;
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = solid(GREEN);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  const dashDayStart = dashHeaderRow + 1;
  (dateKeys.length > 0 ? dateKeys : ['']).forEach((key, i) => {
    const r = dashDayStart + i;
    const dayRows = sorted.filter((s) => new Date(s.sale_date).toISOString().slice(0, 10) === key);
    const rev = dayRows.reduce((sum, s) => sum + Number(s.total), 0);
    dash.getCell(r, 7).value = key ? new Date(key) : '—';
    if (key) dash.getCell(r, 7).numFmt = 'dd mmm yyyy';
    dash.getCell(r, 8).value = rev;
    dash.getCell(r, 8).numFmt = TZS_FMT;
    dash.getCell(r, 9).value = dayRows.length;
    [7, 8, 9].forEach((c) => {
      dash.getCell(r, c).font = { name: FONT, size: 10 };
      dash.getCell(r, c).alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });
  const dashDayEnd = dashDayStart + Math.max(dateKeys.length, 1) - 1;
  if (dateKeys.length > 0) {
    dash.addConditionalFormatting({
      ref: `H${dashDayStart}:H${dashDayEnd}`,
      rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: GREEN }, priority: 1 } as any],
    });
  }

  const dashNoteRow = Math.max(dashStaffEnd, dashDayEnd) + 2;
  dash.mergeCells(`A${dashNoteRow}:L${dashNoteRow}`);
  const dashNote = dash.getCell(dashNoteRow, 1);
  dashNote.value =
    'These two tables mirror the Breakdown tab (see that tab for the live formulas). Exact per-sale detail, with filters, is on the Sales Data tab.';
  dashNote.font = { name: FONT, italic: true, size: 8.5, color: { argb: SLATE } };

  // -------------------------------------------------------------------
  // Sales Data — the filterable, colored detail table
  // -------------------------------------------------------------------
  const sd = workbook.addWorksheet('Sales Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  const headers = [
    'Invoice No.',
    'Date',
    'Day',
    'Served By',
    'Total Amount (TZS)',
    'Discount (TZS)',
    'Net Amount (TZS)',
    'Discount %',
    'Status',
  ];
  sd.getRow(1).values = headers;
  sd.getRow(1).eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = solid(GREEN);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  const widths = [16, 13, 12, 14, 20, 16, 18, 12, 13];
  widths.forEach((w, i) => (sd.getColumn(i + 1).width = w));

  sorted.forEach((s, i) => {
    const r = firstRow + i;
    const total = Number(s.total);
    const discount = Number(s.total_discount ?? 0);
    const row = sd.getRow(r);
    row.getCell(1).value = s.invoice_number;
    row.getCell(2).value = new Date(s.sale_date);
    row.getCell(2).numFmt = 'dd mmm yyyy';
    row.getCell(3).value = { formula: `TEXT(B${r},"dddd")`, result: new Date(s.sale_date).toLocaleDateString('en-US', { weekday: 'long' }) };
    row.getCell(4).value = s.served_by_name;
    row.getCell(5).value = total;
    row.getCell(5).numFmt = TZS_FMT;
    row.getCell(6).value = discount;
    row.getCell(6).numFmt = TZS_FMT;
    row.getCell(7).value = { formula: `E${r}-F${r}`, result: total - discount };
    row.getCell(7).numFmt = TZS_FMT;
    row.getCell(8).value = { formula: `IF(E${r}=0,0,F${r}/E${r})`, result: total === 0 ? 0 : discount / total };
    row.getCell(8).numFmt = '0.0%';
    row.getCell(9).value = s.status;
    row.eachCell((cell, colNum) => {
      cell.font = cell.font ?? { name: FONT, size: 10 };
      cell.alignment = { horizontal: colNum === 4 ? 'left' : 'center', vertical: 'middle' };
    });
  });

  if (n > 0) {
    sd.autoFilter = `A1:I${1 + n}`;
    sd.addConditionalFormatting({
      ref: `E${firstRow}:E${1 + n}`,
      rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: GREEN }, priority: 1 } as any],
    });
    sd.addConditionalFormatting({
      ref: `A${firstRow}:I${1 + n}`,
      rules: [{ type: 'expression', formulae: [`$F${firstRow}>0`], style: { fill: solid(AMBER_LIGHT) }, priority: 2 } as any],
    });
    sd.addConditionalFormatting({
      ref: `I${firstRow}:I${1 + n}`,
      rules: [
        { type: 'expression', formulae: [`$I${firstRow}="COMPLETED"`], style: { font: { name: FONT, color: { argb: GREEN }, bold: true } }, priority: 3 } as any,
        { type: 'expression', formulae: [`$I${firstRow}<>"COMPLETED"`], style: { font: { name: FONT, color: { argb: RED }, bold: true } }, priority: 4 } as any,
      ],
    });
  }

  const salesNoteRow = 2 + n + 1;
  const salesNote = sd.getCell(salesNoteRow, 1);
  salesNote.value =
    'Discount % = Discount (TZS) ÷ Total Amount (TZS). Net Amount = Total Amount − Discount. Both are formulas, not typed-in figures — they recompute if a value above changes.';
  salesNote.font = { name: FONT, italic: true, size: 8.5, color: { argb: SLATE } };

  // -------------------------------------------------------------------
  // Breakdown — the staff/day summary tables the Dashboard's mini-tables
  // above are mirrored from, visible rather than hidden so every number is
  // traceable to a live formula pulling from Sales Data.
  // -------------------------------------------------------------------
  const bd = workbook.addWorksheet('Breakdown');
  bd.getCell(1, 1).value = 'Revenue by Staff';
  bd.getCell(1, 1).font = { name: FONT, bold: true, size: 12, color: { argb: GREEN } };
  const staffHeader = ['Staff', 'Transactions', 'Revenue (TZS)', 'Discount (TZS)', 'Net Revenue (TZS)', 'Avg Sale (TZS)'];
  staffHeader.forEach((h, i) => {
    const cell = bd.getCell(2, i + 1);
    cell.value = h;
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = solid(BLUE);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  const staffStart = 3;
  const staffRange = `$D$${firstRow}:$D$${dataLastRow}`;
  (staffNames.length > 0 ? staffNames : ['—']).forEach((name, i) => {
    const r = staffStart + i;
    const staffSales = sorted.filter((s) => s.served_by_name === name);
    bd.getCell(r, 1).value = name;
    bd.getCell(r, 2).value = { formula: `COUNTIF('Sales Data'!${staffRange},$A${r})`, result: staffSales.length };
    bd.getCell(r, 3).value = {
      formula: `SUMIF('Sales Data'!${staffRange},$A${r},'Sales Data'!$E$${firstRow}:$E$${dataLastRow})`,
      result: staffSales.reduce((sum, s) => sum + Number(s.total), 0),
    };
    bd.getCell(r, 4).value = {
      formula: `SUMIF('Sales Data'!${staffRange},$A${r},'Sales Data'!$F$${firstRow}:$F$${dataLastRow})`,
      result: staffSales.reduce((sum, s) => sum + Number(s.total_discount ?? 0), 0),
    };
    bd.getCell(r, 5).value = { formula: `C${r}-D${r}` };
    bd.getCell(r, 6).value = { formula: `IF(B${r}=0,0,C${r}/B${r})` };
    [3, 4, 5, 6].forEach((c) => (bd.getCell(r, c).numFmt = TZS_FMT));
    for (let c = 1; c <= 6; c++) {
      bd.getCell(r, c).font = { name: FONT, size: 10 };
      bd.getCell(r, c).alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle' };
    }
  });
  const staffEnd = staffStart + Math.max(staffNames.length, 1) - 1;
  if (staffNames.length > 0) {
    bd.addConditionalFormatting({
      ref: `C${staffStart}:C${staffEnd}`,
      rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: BLUE }, priority: 1 } as any],
    });
  }

  const dayTitleRow = staffEnd + 2;
  bd.getCell(dayTitleRow, 1).value = 'Revenue by Day';
  bd.getCell(dayTitleRow, 1).font = { name: FONT, bold: true, size: 12, color: { argb: GREEN } };
  const dayHeaderRow = dayTitleRow + 1;
  const dayHeader = ['Date', 'Transactions', 'Revenue (TZS)', 'Discount (TZS)', 'Net Revenue (TZS)'];
  dayHeader.forEach((h, i) => {
    const cell = bd.getCell(dayHeaderRow, i + 1);
    cell.value = h;
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = solid(GREEN);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  const dayStart = dayHeaderRow + 1;
  const dateRange = `$B$${firstRow}:$B$${dataLastRow}`;
  (dateKeys.length > 0 ? dateKeys : ['']).forEach((key, i) => {
    const r = dayStart + i;
    const dayRows = sorted.filter((s) => new Date(s.sale_date).toISOString().slice(0, 10) === key);
    if (key) {
      bd.getCell(r, 1).value = new Date(key);
      bd.getCell(r, 1).numFmt = 'dd mmm yyyy';
    } else {
      bd.getCell(r, 1).value = '—';
    }
    bd.getCell(r, 2).value = { formula: `COUNTIFS('Sales Data'!${dateRange},$A${r})`, result: dayRows.length };
    bd.getCell(r, 3).value = {
      formula: `SUMIFS('Sales Data'!$E$${firstRow}:$E$${dataLastRow},'Sales Data'!${dateRange},$A${r})`,
      result: dayRows.reduce((sum, s) => sum + Number(s.total), 0),
    };
    bd.getCell(r, 4).value = {
      formula: `SUMIFS('Sales Data'!$F$${firstRow}:$F$${dataLastRow},'Sales Data'!${dateRange},$A${r})`,
      result: dayRows.reduce((sum, s) => sum + Number(s.total_discount ?? 0), 0),
    };
    bd.getCell(r, 5).value = { formula: `C${r}-D${r}` };
    [3, 4, 5].forEach((c) => (bd.getCell(r, c).numFmt = TZS_FMT));
    for (let c = 1; c <= 5; c++) {
      bd.getCell(r, c).font = { name: FONT, size: 10 };
      bd.getCell(r, c).alignment = { horizontal: 'center', vertical: 'middle' };
    }
  });
  const dayEnd = dayStart + Math.max(dateKeys.length, 1) - 1;
  if (dateKeys.length > 0) {
    bd.addConditionalFormatting({
      ref: `C${dayStart}:C${dayEnd}`,
      rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: GREEN }, priority: 1 } as any],
    });
  }
  [16, 14, 16, 15, 17, 15].forEach((w, i) => (bd.getColumn(i + 1).width = w));

  const helperNote = bd.getCell(1, 8);
  helperNote.value =
    "This sheet only holds formulas that pull from 'Sales Data' — nothing here is typed in. The Dashboard's cards mirror these values.";
  helperNote.font = { name: FONT, italic: true, size: 8.5, color: { argb: SLATE } };
  helperNote.alignment = { wrapText: true, vertical: 'top' };

  workbook.views = [{ activeTab: 0 } as any];

  return { workbook, from, to };
}

export async function streamSalesExcel(fromRaw: string | undefined, toRaw: string | undefined, res: Response) {
  const { workbook, from, to } = await buildSalesExcelWorkbook(fromRaw, toRaw);
  const filename = `Sales-Report-${from}-to-${to}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}
