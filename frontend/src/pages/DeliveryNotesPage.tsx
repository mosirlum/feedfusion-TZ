import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, PackageCheck } from 'lucide-react';
import { deliveryNotesApi, apiErrorMessage } from '../lib/api';
import { DeliveryNote, DeliveryNoteStatus } from '../types';
import { formatDate, todayIso } from '../lib/format';
import { Badge, Button, Card, EmptyState, FullPageSpinner, HeroButton, Input, Select, SummaryHero, Table, Td, Th, THead, Tr } from '../components/ui';
import { useToast } from '../components/ui/Toast';

// Delivery Notes list (2026-10-16). A standalone goods-out document — it is
// issued independently of any sale (the client wants staff to hand one to
// every customer without waiting for the sale to be completed) and never
// touches stock. An optional link to the eventual sale's invoice number can
// be added at creation or later.
const STATUS_TONE: Record<DeliveryNoteStatus, 'blue' | 'green' | 'red'> = {
  ISSUED: 'blue',
  DELIVERED: 'green',
  CANCELLED: 'red',
};

export default function DeliveryNotesPage() {
  const toast = useToast();
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeliveryNoteStatus>('all');

  useEffect(() => {
    deliveryNotesApi
      .list()
      .then((res) => setNotes(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load delivery notes.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (statusFilter !== 'all' && n.status !== statusFilter) return false;
      if (!q) return true;
      return (
        n.delivery_note_number.toLowerCase().includes(q) ||
        n.customer_name.toLowerCase().includes(q) ||
        (n.vehicle_number ?? '').toLowerCase().includes(q) ||
        (n.driver_name ?? '').toLowerCase().includes(q) ||
        (n.linked_invoice_number ?? '').toLowerCase().includes(q)
      );
    });
  }, [notes, search, statusFilter]);

  const today = todayIso();
  const issuedToday = notes.filter((n) => n.status !== 'CANCELLED' && n.delivery_date.slice(0, 10) === today).length;
  const onTheWay = notes.filter((n) => n.status === 'ISSUED').length;
  const delivered = notes.filter((n) => n.status === 'DELIVERED').length;
  const notLinked = notes.filter((n) => n.status !== 'CANCELLED' && !n.linked_sale_id).length;

  return (
    <div>
      <SummaryHero
        icon={<PackageCheck size={20} />}
        title="Delivery Notes"
        subtitle="Hand the customer a printed delivery note when goods leave — no need to wait for the sale to be completed."
        action={
          <Link to="/delivery-notes/new">
            <HeroButton icon={<Plus size={16} />} tabIndex={-1}>
              New Delivery Note
            </HeroButton>
          </Link>
        }
        lead={{ label: 'Out for delivery', value: onTheWay, hint: 'Issued, not yet marked delivered' }}
        stats={[
          { label: 'Issued today', value: issuedToday },
          { label: 'Delivered', value: delivered },
          { label: 'No sale linked', value: notLinked, hint: 'Link the invoice once the sale is done', tone: notLinked > 0 ? 'warn' : 'default' },
          { label: 'Total notes', value: notes.length },
        ]}
      />

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number, customer, driver, vehicle or invoice…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="sm:w-44">
          <option value="all">All Status</option>
          <option value="ISSUED">Issued</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </Card>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : notes.length === 0 ? (
          <EmptyState
            title="No delivery notes yet."
            description="Create one when goods leave the shop for a customer."
            action={
              <Link to="/delivery-notes/new">
                <Button>Create the first delivery note</Button>
              </Link>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No delivery notes match those filters." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Delivery Note</Th>
                <Th>Customer</Th>
                <Th className="hidden md:table-cell">Date</Th>
                <Th className="hidden lg:table-cell">Driver / Vehicle</Th>
                <Th className="hidden md:table-cell text-right">Items</Th>
                <Th className="hidden lg:table-cell">Invoice</Th>
                <Th className="hidden md:table-cell">Status</Th>
              </tr>
            </THead>
            <tbody>
              {filtered.map((n) => (
                <Tr key={n.id}>
                  <Td>
                    <Link to={`/delivery-notes/${n.id}`} className="font-medium text-blue-700 hover:underline">
                      {n.delivery_note_number}
                    </Link>
                  </Td>
                  <Td className="text-slate-700 dark:text-[#d2dbd5]">
                    {n.customer_name}
                    <span className="block text-xs text-slate-400 dark:text-[#77857c] md:hidden">{formatDate(n.delivery_date)}</span>
                    <span className="mt-1 block md:hidden">
                      <Badge tone={STATUS_TONE[n.status]}>{n.status}</Badge>
                    </span>
                  </Td>
                  <Td className="hidden text-slate-500 dark:text-[#97a49b] md:table-cell">{formatDate(n.delivery_date)}</Td>
                  <Td className="hidden text-slate-500 dark:text-[#97a49b] lg:table-cell">
                    {n.driver_name || n.vehicle_number ? [n.driver_name, n.vehicle_number].filter(Boolean).join(' · ') : '—'}
                  </Td>
                  <Td className="hidden text-right text-slate-500 dark:text-[#97a49b] md:table-cell">{n.item_count ?? 0}</Td>
                  <Td className="hidden text-slate-500 dark:text-[#97a49b] lg:table-cell">{n.linked_invoice_number ?? '—'}</Td>
                  <Td className="hidden md:table-cell">
                    <Badge tone={STATUS_TONE[n.status]}>{n.status}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
