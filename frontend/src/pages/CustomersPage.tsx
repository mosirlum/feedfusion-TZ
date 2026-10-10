import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Search, Phone, Mail, MapPin, Users as UsersIcon } from 'lucide-react';
import { customersApi, apiErrorMessage } from '../lib/api';
import { Customer } from '../types';
import { Badge, Button, Card, EmptyState, FullPageSpinner, Input, Select, Table, Td, Th, THead, Tr, SummaryHero, HeroButton } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { CustomerFormModal } from '../components/CustomerFormModal';

// New Customers page (2026-09-12, Quotations feature, CLAUDE.md #49) — a
// deliberately simple list + add/edit (no stats/charts/detail panel like
// Suppliers has, since a customer here only exists to feed the Quotation
// form's "Ship To" section; nothing in this schema tracks per-customer
// purchase history the way suppliers.total_purchases does for purchases).
export default function CustomersPage() {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  function load() {
    setLoading(true);
    customersApi
      .list()
      .then((res) => setCustomers(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load customers.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.address ?? '').toLowerCase().includes(q)
      );
    });
  }, [customers, search, statusFilter]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    setFormOpen(true);
  }
  function afterSave() {
    setFormOpen(false);
    load();
  }

  return (
    <div>
      <SummaryHero
        icon={<UsersIcon size={20} />}
        title="Customers"
        subtitle="Saved customer details — used to fill a Quotation's Ship To section automatically."
        action={
          <HeroButton icon={<Plus size={16} />} onClick={openCreate}>
            Add Customer
          </HeroButton>
        }
        lead={{ label: 'Customers saved', value: customers.length, hint: loading ? undefined : `${customers.filter((c) => c.status === 'active').length} active` }}
        stats={[
          { label: 'Active', value: customers.filter((c) => c.status === 'active').length },
          { label: 'Inactive', value: customers.filter((c) => c.status === 'inactive').length },
          {
            label: 'No phone number',
            value: customers.filter((c) => !c.phone).length,
            hint: 'Hard to call about a debt',
            tone: customers.some((c) => !c.phone) ? 'warn' : 'default',
          },
        ]}
      />

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, or address…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="sm:w-40">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </Card>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : customers.length === 0 ? (
          <EmptyState title="No customers yet." description="Add one here, or save one straight from the Quotation form." action={<Button onClick={openCreate}>Add the first customer</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No customers match those filters." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th>Phone</Th>
                <Th className="hidden md:table-cell">Email</Th>
                <Th className="hidden md:table-cell">Address</Th>
                <Th className="hidden sm:table-cell">Status</Th>
                <Th></Th>
              </tr>
            </THead>
            <tbody>
              {filtered.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium text-slate-800 dark:text-[#eef3ef]">
                    {c.name}
                    {(c.email || c.address) && (
                      <span className="mt-0.5 block whitespace-normal text-xs font-normal text-slate-500 dark:text-[#97a49b] md:hidden">
                        {[c.email, c.address].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <span className="mt-1 block sm:hidden">
                      <Badge tone={c.status === 'active' ? 'green' : 'slate'}>{c.status}</Badge>
                    </span>
                  </Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">
                    {c.phone ? (
                      <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="flex items-center gap-1.5 hover:text-green-700 hover:underline" aria-label={`Call ${c.name}`}>
                        <Phone size={13} className="flex-shrink-0 text-slate-400 dark:text-[#77857c]" /> {c.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="hidden text-slate-500 dark:text-[#97a49b] md:table-cell">
                    {c.email ? (
                      <span className="flex items-center gap-1.5">
                        <Mail size={13} className="flex-shrink-0 text-slate-400 dark:text-[#77857c]" /> {c.email}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="hidden text-slate-500 dark:text-[#97a49b] md:table-cell">
                    {c.address ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin size={13} className="flex-shrink-0 text-slate-400 dark:text-[#77857c]" /> {c.address}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <Badge tone={c.status === 'active' ? 'green' : 'slate'}>{c.status}</Badge>
                  </Td>
                  <Td>
                    <button onClick={() => openEdit(c)} className="text-slate-400 dark:text-[#77857c] hover:text-amber-600" title="Edit customer" aria-label={`Edit ${c.name}`}>
                      <Pencil size={16} />
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <CustomerFormModal open={formOpen} onClose={() => setFormOpen(false)} editing={editing} onSaved={afterSave} />
    </div>
  );
}
