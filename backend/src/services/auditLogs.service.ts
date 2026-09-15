import * as auditRepo from '../db/auditRepo';
import { previousPeriodRange, pctChange } from '../utils/period';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GetAuditLogsParams {
  entityType?: string;
  entityId?: number;
  from?: string;
  to?: string;
  userId?: number;
  action?: string;
  feature?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/**
 * Audit Log Center (2026-09-12, CLAUDE.md #43) — adds "vs previous period"
 * trends to the page's stat cards, reusing the same helper Sales History
 * (CLAUDE.md #34) and Reports' Sales Overview (CLAUDE.md #41) already use,
 * so all three places compute "the immediately preceding period of equal
 * length" the same way. Only computed when a real date range is given
 * (entity-scoped lookups, e.g. a single product's history, don't have one).
 *
 * The mockup this page was built from shows Total Events as a percentage
 * change but Unique Users / Different Actions as a plain count delta
 * ("+2", "+3") — kept that distinction rather than forcing all three
 * through the same percentage math, since a swing from 5 to 7 unique staff
 * reads better as "+2 people" than "+40%".
 */
export async function getAuditLogs(params: GetAuditLogsParams) {
  const current = await auditRepo.listAuditLogs(params);

  let trend: { totalEventsPct: number | null; uniqueUsersDelta: number | null; differentActionsDelta: number | null } = {
    totalEventsPct: null,
    uniqueUsersDelta: null,
    differentActionsDelta: null,
  };

  if (params.from && params.to && DATE_RE.test(params.from) && DATE_RE.test(params.to)) {
    const { prevFrom, prevTo } = previousPeriodRange(params.from, params.to);
    const previous = await auditRepo.listAuditLogs({ ...params, from: prevFrom, to: prevTo, page: 1, pageSize: 1 });
    trend = {
      totalEventsPct: pctChange(current.summary.totalEvents, previous.summary.totalEvents),
      uniqueUsersDelta: current.summary.uniqueUsers - previous.summary.uniqueUsers,
      differentActionsDelta: current.summary.differentActions - previous.summary.differentActions,
    };
  }

  return { ...current, summary: { ...current.summary, trend } };
}
