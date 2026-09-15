import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, FileText } from 'lucide-react';
import { quotationsApi, apiErrorMessage } from '../lib/api';
import { Quotation, QuotationStatus } from '../types';
import { tzs, formatDate } from '../lib/format';
import { Badge, Card, EmptyState, FullPageSpinner, Input, PageHeader, Select, Table, Td, Th, THead, Tr, Button } from '../components/ui';
import { useToast } from '../components/ui/Toast';

// New Quotations list page (2026-09-12, CLAUDE.md #49) — the app-side
// equivalent of the "QUOTATION" Word template delivered earlier, now a
// proper feature: create, list, view/print, change status, and convert an
// accepted one into a real POS sale.
const STATUS_TONE: Record<QuotationStatus, 'slate' | 'green' | 'blue' | 'red' | 'amber'> = {
  DRAFT: 'slate',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  EXPIRED: 'amber',
  CONVERTED: 'green',
};

export default function QuotationsPage() {
  const toast = useToast();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QuotationStatus>('all');

  useEffect(() => {
    quotationsApi
      .list()
      .then((res) => setQuotations(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load quotations.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotations.filter((quo) => {
      if (statusFilter !== 'all' && quo.status !== statusFilter) return false;
      if (!q) return true;
      return quo.quotation_number.toLowerCase().includes(q) || quo.customer_name.toLowerCase().includes(q);
    });
  }, [quotations, search, statusFilter]);

  return (
    <div>
      <PageHeader
        icon={<FileText size={20} />}
        title="Quotations"
        subtitle="Quote a price to a customer before the sale — printable, and convertible to a real sale once accepted."
        action={
          <Link to="/quotations/new">
            <Button icon={<Plus size={16} />}>New Quotation</Button>
          </Link>
        }
      />

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by quotation number or customer…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="sm:w-44">
          <option value="all">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option>
          <option value="CONVERTED">Converted</option>
        </Select>
      </Card>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : quotations.length === 0 ? (
          <EmptyState
            title="No quotations yet."
            description="Create one to quote a price to a customer before they buy."
            action={
              <Link to="/quotations/new">
                <Button>Create the first quotation</Button>
              </Link>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No quotations match those filters." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Quotation</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th>Valid Until</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
                <Th>Created By</Th>
              </tr>
            </THead>
            <tbody>
              {filtered.map((quo) => (
                <Tr key={quo.id}>
                  <Td>
                    <Link to={`/quotations/${quo.id}`} className="font-medium text-blue-700 hover:underline">
                      {quo.quotation_number}
                    </Link>
                  </Td>
                  <Td className="text-slate-700 dark:text-[#d2dbd5]">{quo.customer_name}</Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">{formatDate(quo.quotation_date)}</Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">{quo.valid_until ? formatDate(quo.valid_until) : '—'}</Td>
                  <Td className="text-right font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(quo.total)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[quo.status]}>{quo.status}</Badge>
                  </Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">{quo.created_by_name ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
