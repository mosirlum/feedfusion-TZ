import { Request, Response, NextFunction } from 'express';
import * as reportsService from '../services/reports.service';
import * as narrativeReportService from '../services/narrativeReport.service';
import * as pdfReportService from '../services/pdfReport.service';
import * as salesExcelReportService from '../services/salesExcelReport.service';

function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' ? v : undefined;
}

export async function salesReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getSalesReport(q(req, 'from'), q(req, 'to')));
  } catch (err) {
    next(err);
  }
}

export async function productsReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getProductSalesReport(q(req, 'from'), q(req, 'to')));
  } catch (err) {
    next(err);
  }
}

export async function stockReportHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getStockReport());
  } catch (err) {
    next(err);
  }
}

export async function lowStockReportHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getLowStockReport());
  } catch (err) {
    next(err);
  }
}

export async function discountsReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userIdRaw = q(req, 'user_id');
    const userId = userIdRaw && Number.isInteger(Number(userIdRaw)) ? Number(userIdRaw) : undefined;
    res.status(200).json(await reportsService.getDiscountsReport(q(req, 'from'), q(req, 'to'), userId));
  } catch (err) {
    next(err);
  }
}

export async function cashReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getCashReport(q(req, 'from'), q(req, 'to')));
  } catch (err) {
    next(err);
  }
}

export async function usersReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getUsersReport(q(req, 'from'), q(req, 'to')));
  } catch (err) {
    next(err);
  }
}

export async function salesOverviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getSalesOverview(q(req, 'from'), q(req, 'to')));
  } catch (err) {
    next(err);
  }
}

export async function purchaseCostsReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await reportsService.getPurchaseCostsReport(q(req, 'from'), q(req, 'to')));
  } catch (err) {
    next(err);
  }
}

/**
 * Narrative Business Report (2026-09-13, CLAUDE.md #64) — the one Reports
 * handler that doesn't respond with JSON. Builds the rule-based narrative
 * (narrativeReport.service.ts) from the same from/to range every other
 * Reports endpoint accepts, then streams it as a real PDF file
 * (pdfReport.service.ts) with a Content-Disposition download header,
 * instead of returning data for the frontend to render.
 */
export async function narrativeReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const report = await narrativeReportService.buildNarrativeReport(q(req, 'from'), q(req, 'to'));
    pdfReportService.streamNarrativePdf(report, res);
  } catch (err) {
    next(err);
  }
}

/**
 * Sales Excel Report (2026-09-14, CLAUDE.md #68e) — the Sales tab's
 * "Download" button now streams this instead of building a plain CSV
 * client-side. `from`/`to` are validated inside
 * salesExcelReport.service.ts's own call to reportsService.getSalesReport,
 * same as every other reports.* endpoint — not re-validated here.
 */
export async function salesExcelReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await salesExcelReportService.streamSalesExcel(q(req, 'from'), q(req, 'to'), res);
  } catch (err) {
    next(err);
  }
}
