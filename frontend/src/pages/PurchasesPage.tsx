import axios from 'axios';
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Eye,
  Pencil,
  Phone,
  MapPin,
  ShoppingCart,
  ClipboardCheck,
  X,
  Warehouse,
  Package,
  Banknote,
  Info,
  FileText,
  Calendar,
  ChevronDown,
  Truck,
  Search,
  Clock,
  TrendingUp,
  Paperclip,
  Camera,
} from 'lucide-react';
import { purchasesApi, suppliersApi, productsApi, apiErrorMessage } from '../lib/api';
import { Supplier, Product, Purchase } from '../types';
import { tzs, formatDate, todayIso, initials } from '../lib/format';
import { isValidTzPhone, sanitizePhoneInput, TZ_PHONE_PLACEHOLDER, TZ_PHONE_ERROR } from '../lib/phone';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  FormField,
  FullPageSpinner,
  IconChip,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  Table,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';

/**
 * Purchases page polish (2026-09-12, CLAUDE.md #46) — the last shared page
 * (used by both Owner and Sales) still in the pre-redesign plain style;
 * the recording form itself already had Card/IconChip sections from earlier
 * work, so this pass adds a PageHeader subtitle, a real stat-cards row, and
 * a search box over Recent Purchases, matching Suppliers/Products/Stock
 * Count. All 4 stat cards are computed from the same `GET /purchases`
 * (capped at the last 50, same as the table below it) — no new endpoint,
 * and no fabricated "vs last month" trend, since the underlying data is
 * already just "the last 50 shown," not a real date-range query. The 4th
 * card differs by role: the owner sees "Pending Corrections" (a real count
 * from `GET /purchases/edit-requests?status=PENDING`, which only the owner
 * can call — CLAUDE.md #35's approval queue); a sales/manager user, who
 * can't call that endpoint, sees "Avg per Purchase" instead so nothing 403s.
 */

interface DraftLine {
  key: string;
  productId: string;
  quantity: string;
  unitCost: string;
}

// One "Product" card section per category the owner is buying in this
// purchase — e.g. a section headed "1. Poultry Feed" holding its own item
// rows, and a separate "2. Fish Feed" section if the same purchase/supplier
// also delivered fish feed. The category itself is chosen once per section
// (as a header, not repeated per row) — see judgment call #19 in CLAUDE.md.
interface ItemSection {
  key: string;
  categoryKey: string;
  lines: DraftLine[];
}

// Trimmed to just the two costs that actually recur on a delivery, plus a
// catch-all — the owner first asked to remove the 5-option preset dropdown
// in favor of free text (see CLAUDE.md #24), then asked for a short preset
// list back after finding plain free text less convenient day-to-day.
type ExpenseTypeOption = 'LABOUR' | 'TRANSPORT_DELIVERY' | 'OTHER';
const EXPENSE_TYPE_OPTIONS: Array<{ value: ExpenseTypeOption; label: string }> = [
  { value: 'LABOUR', label: 'Labour' },
  { value: 'TRANSPORT_DELIVERY', label: 'Transport / Delivery' },
  { value: 'OTHER', label: 'Other' },
];

interface CostLine {
  key: string;
  type: ExpenseTypeOption | '';
  customLabel: string;
  amount: string;
}

// Draft rows for correcting an already-recorded purchase (2026-09-11) — only
// quantity/unit cost (items) and amount (expenses) are editable here; the
// product, supplier, date, and which lines exist are all fixed. See
// CLAUDE.md for the full design writeup.
interface EditDraftItem {
  purchaseItemId: number;
  productName: string;
  unit: string;
  quantity: string;
  unitCost: string;
}
interface EditDraftCostLine {
  costLineId: number;
  label: string;
  amount: string;
}

let seq = 0;
function nextKey(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function emptyLine(): DraftLine {
  return { key: nextKey('ln'), productId: '', quantity: '', unitCost: '' };
}

function emptySection(): ItemSection {
  return { key: nextKey('sec'), categoryKey: '', lines: [emptyLine()] };
}

// Attach the supplier's invoice/quotation to a purchase — a photo or a
// PDF (2026-09-14, CLAUDE.md #68; PDF added same day as a follow-up to
// the photo-only first version) — same base64 data: URL pattern as the
// user avatar photo (MyProfilePage.tsx): no file-upload middleware exists
// on this backend, so a photo is resized/compressed client-side via
// <canvas> before it's ever sent. A bigger max dimension than the 256px
// avatar uses (1400px) — the point of this photo is being able to read
// real numbers off it later, so it can't be shrunk as aggressively.
const MAX_DOCUMENT_DIMENSION = 1400;
// A PDF can't be shrunk the way a photo can (no canvas re-encode of PDF
// content), so it's capped by raw size instead — 2MB, which becomes
// ~2.7MB once base64-encoded, comfortably inside the 3mb express.json
// limit (app.ts) alongside the rest of that request's JSON.
const MAX_PDF_BYTES = 2 * 1024 * 1024;

function resizeDocumentPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that photo.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DOCUMENT_DIMENSION / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process that photo.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function readPdfAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PDF_BYTES) {
      reject(new Error('That PDF is larger than 2MB — please attach a smaller file, or a photo instead.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that PDF.'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function isPdfDataUrl(url: string): boolean {
  return url.startsWith('data:application/pdf');
}

export default function PurchasesPage() {
  const toast = useToast();
  const { isOwner } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierAddress, setNewSupplierAddress] = useState('');
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  // Simple sequential reference — "PO-2026-0001", "PO-2026-0002", ... — the
  // real one is assigned by the backend on submit; this is fetched from
  // /purchases/next-reference just to show the owner what it'll look like
  // (visibly, not left blank — a silent submit-time-only value read as
  // "not working" when the owner couldn't see it while filling the form).
  const [referenceNumber, setReferenceNumber] = useState('');
  const [referenceEdited, setReferenceEdited] = useState(false);
  const [costLines, setCostLines] = useState<CostLine[]>([]);
  const [notes, setNotes] = useState('');
  const [documentDataUrl, setDocumentDataUrl] = useState<string | null>(null);
  const [documentProcessing, setDocumentProcessing] = useState(false);
  const [sections, setSections] = useState<ItemSection[]>([emptySection()]);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const [viewPurchase, setViewPurchase] = useState<Purchase | null>(null);
  const [recentPurchases, setRecentPurchases] = useState<Purchase[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentSearch, setRecentSearch] = useState('');
  const [pendingPurchaseIds, setPendingPurchaseIds] = useState<Set<number>>(new Set());

  // Correcting an already-recorded purchase (2026-09-11) — see CLAUDE.md.
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [editDraftItems, setEditDraftItems] = useState<EditDraftItem[]>([]);
  const [editDraftCostLines, setEditDraftCostLines] = useState<EditDraftCostLine[]>([]);
  const [editReason, setEditReason] = useState('');
  const [openingEditForId, setOpeningEditForId] = useState<number | null>(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  function fetchNextReference() {
    purchasesApi
      .nextReference()
      .then((res) => setReferenceNumber(res.data.referenceNumber))
      .catch(() => {
        // Non-fatal — the backend still generates one at submit time if this
        // field is left blank; the owner just won't see a preview.
      });
  }

  useEffect(() => {
    fetchNextReference();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    suppliersApi
      .list()
      .then((res) => setSuppliers(res.data))
      .catch((err) => {
        setLoadError(true);
        toast.error(apiErrorMessage(err, 'Could not load suppliers — try refreshing the page.'));
      });
    productsApi
      .list(true)
      .then((res) => setProducts(res.data))
      .catch((err) => {
        setLoadError(true);
        toast.error(apiErrorMessage(err, 'Could not load products — try refreshing the page.'));
      })
      .finally(() => setCatalogLoading(false));
    purchasesApi
      .list()
      .then((res) => setRecentPurchases(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load recent purchases.')))
      .finally(() => setLoadingRecent(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pending Corrections count/badges — owner-only endpoint (the approval
  // queue itself lives on the Change Approval Center, CLAUDE.md #35); a
  // sales/manager user can't call this, so it's simply never fetched for
  // them rather than surfacing a 403.
  useEffect(() => {
    if (!isOwner) return;
    purchasesApi
      .listEditRequests('PENDING')
      .then((res) => setPendingPurchaseIds(new Set(res.data.map((r) => r.purchase_id))))
      .catch(() => {
        // Non-fatal — the stat card/badges just won't show if this fails;
        // the Change Approval Center remains the source of truth.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  const purchaseStats = useMemo(() => {
    const count = recentPurchases.length;
    const totalValue = recentPurchases.reduce((sum, p) => sum + Number(p.total_cost), 0);
    const supplierCount = new Set(recentPurchases.map((p) => p.supplier_id)).size;
    const avgValue = count > 0 ? totalValue / count : 0;
    return { count, totalValue, supplierCount, avgValue };
  }, [recentPurchases]);

  const filteredRecentPurchases = useMemo(() => {
    const q = recentSearch.trim().toLowerCase();
    if (!q) return recentPurchases;
    return recentPurchases.filter(
      (p) => (p.supplier_name ?? '').toLowerCase().includes(q) || p.reference_number.toLowerCase().includes(q)
    );
  }, [recentPurchases, recentSearch]);

  const selectedSupplier = suppliers.find((s) => String(s.id) === supplierId) ?? null;

  async function handleCreateSupplier() {
    const trimmed = newSupplierName.trim();
    if (!trimmed) return;
    if (newSupplierPhone.trim() && !isValidTzPhone(newSupplierPhone)) {
      toast.error(TZ_PHONE_ERROR);
      return;
    }
    setCreatingSupplier(true);
    try {
      const res = await suppliersApi.create({
        name: trimmed,
        phone: newSupplierPhone.trim() || undefined,
        address: newSupplierAddress.trim() || undefined,
      });
      setSuppliers((prev) => [...prev, res.data]);
      setSupplierId(String(res.data.id));
      setAddingSupplier(false);
      setNewSupplierName('');
      setNewSupplierPhone('');
      setNewSupplierAddress('');
      toast.success(`Supplier "${res.data.name}" added — it's in Suppliers too now.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create this supplier.'));
    } finally {
      setCreatingSupplier(false);
    }
  }

  function addSection() {
    setSections((prev) => [...prev, emptySection()]);
  }
  function removeSection(sectionKey: string) {
    setSections((prev) => prev.filter((s) => s.key !== sectionKey));
  }
  function setSectionCategory(sectionKey: string, categoryKey: string) {
    // Changing category invalidates any products already picked under the old
    // one, so the section's rows reset to a single blank line.
    setSections((prev) => prev.map((s) => (s.key === sectionKey ? { ...s, categoryKey, lines: [emptyLine()] } : s)));
  }
  function addLine(sectionKey: string) {
    setSections((prev) => prev.map((s) => (s.key === sectionKey ? { ...s, lines: [...s.lines, emptyLine()] } : s)));
  }
  function updateLine(sectionKey: string, lineKey: string, patch: Partial<DraftLine>) {
    setSections((prev) =>
      prev.map((s) =>
        s.key === sectionKey ? { ...s, lines: s.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) } : s
      )
    );
  }
  function removeLine(sectionKey: string, lineKey: string) {
    setSections((prev) =>
      prev.map((s) => (s.key === sectionKey ? { ...s, lines: s.lines.filter((l) => l.key !== lineKey) } : s))
    );
  }
  function unitFor(productId: string) {
    return products.find((p) => String(p.id) === productId)?.unit ?? null;
  }

  async function handleDocumentChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDocumentProcessing(true);
    try {
      const dataUrl = file.type === 'application/pdf' ? await readPdfAsDataUrl(file) : await resizeDocumentPhoto(file);
      setDocumentDataUrl(dataUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not process that file.');
    } finally {
      setDocumentProcessing(false);
    }
  }

  function addCostLine() {
    setCostLines((prev) => [...prev, { key: nextKey('cl'), type: '', customLabel: '', amount: '' }]);
  }
  function updateCostLine(key: string, patch: Partial<CostLine>) {
    setCostLines((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }
  function removeCostLine(key: string) {
    setCostLines((prev) => prev.filter((c) => c.key !== key));
  }
  function labelFor(c: CostLine) {
    if (c.type === 'OTHER') return c.customLabel.trim();
    return EXPENSE_TYPE_OPTIONS.find((o) => o.value === c.type)?.label ?? '';
  }

  const allLines = sections.flatMap((s) => s.lines);
  const itemsSubtotal = allLines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const activeCostLines = costLines.filter((c) => labelFor(c) && Number(c.amount) > 0);
  const additionalCostsTotal = activeCostLines.reduce((sum, c) => sum + Number(c.amount), 0);
  const grandTotal = itemsSubtotal + additionalCostsTotal;

  // Grouped by category (e.g. "Poultry Feed" / "Fish Feed") so it's clear a single
  // purchase can mix line items across both — "Uncategorized" sorts last.
  const productGroups: Array<[string, Product[]]> = (() => {
    const groups = new Map<string, Product[]>();
    for (const p of products) {
      const key = p.category_name ?? 'Uncategorized';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
  })();

  function productsInCategory(categoryKey: string): Product[] {
    return productGroups.find(([key]) => key === categoryKey)?.[1] ?? [];
  }

  // A category can only be picked by one section at a time — once "Poultry
  // Feed" is chosen for section A, it drops out of every other section's
  // list, so adding a second product from the same category means adding a
  // line inside the existing section, not a duplicate section.
  function categoryOptionsFor(sectionKey: string): Array<[string, Product[]]> {
    const usedElsewhere = new Set(sections.filter((s) => s.key !== sectionKey && s.categoryKey).map((s) => s.categoryKey));
    return productGroups.filter(([name]) => !usedElsewhere.has(name));
  }
  const canAddSection = productGroups.length > 0 && sections.length < productGroups.length;

  // What the Purchase Summary renders: one block per section that actually has
  // a category and at least one product picked, numbered by that category's
  // fixed position (Poultry Feed is always "1", Fish Feed always "2", ...).
  const summarySections = sections
    .filter((s) => s.categoryKey)
    .map((s) => ({
      categoryKey: s.categoryKey,
      catIdx: productGroups.findIndex(([name]) => name === s.categoryKey),
      entries: s.lines
        .filter((l) => l.productId)
        .map((l) => ({ line: l, product: products.find((p) => String(p.id) === l.productId) }))
        .filter((e): e is { line: DraftLine; product: Product } => !!e.product),
    }))
    .filter((s) => s.entries.length > 0);

  // Applies a successfully-recorded purchase to the UI — shared by the
  // normal success path and the "recovered after a lost response" path
  // below, since both end up in the same state.
  function applySuccessfulPurchase(purchase: Purchase, message: string) {
    toast.success(message);
    setRecentPurchases((prev) => [purchase, ...prev.filter((p) => p.id !== purchase.id)]);
    setSupplierId('');
    setReferenceEdited(false);
    fetchNextReference();
    setCostLines([]);
    setNotes('');
    setDocumentDataUrl(null);
    setSections([emptySection()]);
  }

  // Looks for a purchase that matches what was just submitted, to tell a
  // genuine failure apart from a lost/delayed response to a request that
  // actually succeeded (see the comment in handleSubmit's catch block).
  // Newest-first, and only the most recent few, so an older purchase that
  // happens to share a supplier and total by coincidence isn't mistaken
  // for this one.
  async function findJustRecordedPurchase(supplierIdNum: number, expectedTotal: number): Promise<Purchase | null> {
    try {
      const res = await purchasesApi.list();
      return (
        res.data
          .slice(0, 5)
          .find((p) => p.supplier_id === supplierIdNum && Math.abs(Number(p.total_cost) - expectedTotal) < 1) ?? null
      );
    } catch {
      return null;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validLines = allLines.filter((l) => l.productId && l.quantity && l.unitCost);
    if (!supplierId || validLines.length === 0) {
      toast.error('Choose a supplier and at least one complete line item.');
      return;
    }
    setSubmitting(true);
    const submittedSupplierId = Number(supplierId);
    const submittedTotal = grandTotal;
    try {
      const res = await purchasesApi.create({
        supplierId: submittedSupplierId,
        // Blank is fine — the backend assigns the next sequential number.
        referenceNumber: referenceNumber.trim() || undefined,
        purchaseDate,
        additionalCostLines: activeCostLines.map((c) => ({ label: labelFor(c), amount: Number(c.amount) })),
        notes: notes.trim() || undefined,
        documentDataUrl,
        items: validLines.map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
      });
      applySuccessfulPurchase(res.data, `Purchase ${res.data.reference_number} recorded — stock updated.`);
    } catch (err) {
      // A request that reached the server can still look like a failure
      // here if its response never arrives — the connection drops, or (on
      // Neon's serverless Postgres) the database was "asleep" and took too
      // long waking up — even though the purchase already committed. The
      // owner reported exactly this: an error toast, then the purchase
      // already there after a refresh. A real rejection from the server
      // (a validation error, a duplicate reference number, etc.) always
      // carries an HTTP status; a response with none at all means it may
      // never have arrived — worth checking before calling it a failure.
      const noResponseReceived = axios.isAxiosError(err) && !err.response;
      const recovered = noResponseReceived ? await findJustRecordedPurchase(submittedSupplierId, submittedTotal) : null;
      if (recovered) {
        applySuccessfulPurchase(recovered, `Purchase ${recovered.reference_number} was recorded — the confirmation was just delayed.`);
      } else {
        toast.error(apiErrorMessage(err, 'Could not record this purchase.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function openPurchase(id: number) {
    try {
      const res = await purchasesApi.get(id);
      setViewPurchase(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not load purchase details.'));
    }
  }

  async function openEditModal(purchaseId: number) {
    setOpeningEditForId(purchaseId);
    try {
      const res = await purchasesApi.get(purchaseId);
      const purchase = res.data;
      setEditingPurchase(purchase);
      setEditDraftItems(
        (purchase.items ?? []).map((item) => ({
          purchaseItemId: item.id,
          productName: item.product_name ?? `Item #${item.id}`,
          unit: products.find((p) => p.id === item.product_id)?.unit ?? '',
          quantity: String(item.quantity),
          unitCost: item.unit_cost,
        }))
      );
      setEditDraftCostLines(
        (purchase.additional_cost_lines ?? []).map((line) => ({
          costLineId: line.id,
          label: line.label,
          amount: line.amount,
        }))
      );
      setEditReason('');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not load this purchase for editing.'));
    } finally {
      setOpeningEditForId(null);
    }
  }

  function closeEditModal() {
    setEditingPurchase(null);
    setEditDraftItems([]);
    setEditDraftCostLines([]);
    setEditReason('');
  }

  function updateEditDraftItem(purchaseItemId: number, patch: Partial<Pick<EditDraftItem, 'quantity' | 'unitCost'>>) {
    setEditDraftItems((prev) => prev.map((it) => (it.purchaseItemId === purchaseItemId ? { ...it, ...patch } : it)));
  }
  function updateEditDraftCostLine(costLineId: number, amount: string) {
    setEditDraftCostLines((prev) => prev.map((c) => (c.costLineId === costLineId ? { ...c, amount } : c)));
  }

  async function handleSubmitEdit() {
    if (!editingPurchase) return;
    if (!isOwner && !editReason.trim()) {
      toast.error('Please explain what was wrong and needs correcting.');
      return;
    }
    // Only send lines that actually changed from the recorded values —
    // comparing as numbers, not raw strings, since the backend's NUMERIC
    // columns round-trip with formatting (e.g. "18000.00") that an untouched
    // input would otherwise falsely flag as "changed".
    const items = editDraftItems
      .filter((it) => {
        const original = editingPurchase.items?.find((o) => o.id === it.purchaseItemId);
        if (!original) return false;
        return Number(it.quantity) !== original.quantity || Number(it.unitCost) !== Number(original.unit_cost);
      })
      .map((it) => ({ purchaseItemId: it.purchaseItemId, quantity: Number(it.quantity), unitCost: Number(it.unitCost) }));
    const costLinesPatch = editDraftCostLines
      .filter((c) => {
        const original = editingPurchase.additional_cost_lines?.find((o) => o.id === c.costLineId);
        if (!original) return false;
        return Number(c.amount) !== Number(original.amount);
      })
      .map((c) => ({ costLineId: c.costLineId, amount: Number(c.amount) }));

    if (items.length === 0 && costLinesPatch.length === 0) {
      toast.error('Change at least one quantity, unit cost, or expense amount first.');
      return;
    }
    setSubmittingEdit(true);
    try {
      const res = await purchasesApi.requestEdit(editingPurchase.id, {
        items,
        costLines: costLinesPatch,
        reason: editReason.trim() || undefined,
      });
      if (res.data.editRequest.status === 'APPROVED') {
        toast.success(`Purchase ${res.data.purchase.reference_number} corrected — stock and totals updated.`);
        setRecentPurchases((prev) => prev.map((p) => (p.id === res.data.purchase.id ? res.data.purchase : p)));
      } else {
        toast.success("Correction sent — it'll apply once the owner approves it.");
      }
      closeEditModal();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not submit this correction.'));
    } finally {
      setSubmittingEdit(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchases"
        subtitle="Record deliveries from suppliers — stock and cost updates automatically."
        icon={<Truck size={20} />}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Purchases Shown" value={purchaseStats.count} icon={<ShoppingCart size={18} />} tone="blue" hint="Last 50, newest first" />
        <StatCard label="Total Value" value={tzs(purchaseStats.totalValue)} icon={<Banknote size={18} />} tone="green" hint="Of purchases shown" />
        <StatCard label="Suppliers" value={purchaseStats.supplierCount} icon={<Warehouse size={18} />} tone="amber" hint="Distinct, of purchases shown" />
        {isOwner ? (
          <StatCard
            label="Pending Corrections"
            value={pendingPurchaseIds.size}
            icon={<Clock size={18} />}
            tone={pendingPurchaseIds.size > 0 ? 'red' : 'purple'}
            hint="Awaiting your review"
          />
        ) : (
          <StatCard label="Avg per Purchase" value={tzs(purchaseStats.avgValue)} icon={<TrendingUp size={18} />} tone="purple" hint="Of purchases shown" />
        )}
      </div>

      <form id="purchase-form" onSubmit={handleSubmit} className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* LEFT: form column */}
        <div className="min-w-0 flex-1 space-y-5">
          {/* Supplier card */}
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <IconChip tone="green" icon={<Warehouse size={17} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Supplier</h3>
            </div>

            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-[#97a49b]">Choose who delivered this stock</label>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>

            {selectedSupplier && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] bg-slate-50 px-3.5 py-2.5">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-xs font-bold text-white">
                  {initials(selectedSupplier.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">{selectedSupplier.name}</p>
                  <p className="flex flex-wrap items-center gap-3 text-xs text-slate-400 dark:text-[#77857c]">
                    {selectedSupplier.phone && (
                      <span className="flex items-center gap-1">
                        <Phone size={11} /> {selectedSupplier.phone}
                      </span>
                    )}
                    {selectedSupplier.address && (
                      <span className="flex items-center gap-1">
                        <MapPin size={11} /> {selectedSupplier.address}
                      </span>
                    )}
                    {!selectedSupplier.phone && !selectedSupplier.address && 'No extra details on file yet.'}
                  </p>
                </div>
              </div>
            )}

            {!addingSupplier ? (
              <button
                type="button"
                onClick={() => setAddingSupplier(true)}
                className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-green-700 hover:text-green-800"
              >
                <Plus size={14} /> Add a new supplier
              </button>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-slate-50/70 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[13px] font-bold text-slate-700 dark:text-[#d2dbd5]">New supplier</p>
                  <button type="button" onClick={() => setAddingSupplier(false)} className="text-slate-400 dark:text-[#77857c] hover:text-slate-600">
                    <X size={15} />
                  </button>
                </div>
                <p className="mb-2 text-xs text-slate-400 dark:text-[#77857c]">Just the essentials — you can fill in the rest later from Suppliers.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input autoFocus placeholder="Supplier name" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} />
                  <Input
                    placeholder={`Phone — optional, ${TZ_PHONE_PLACEHOLDER}`}
                    inputMode="numeric"
                    value={newSupplierPhone}
                    onChange={(e) => setNewSupplierPhone(sanitizePhoneInput(e.target.value))}
                  />
                  <Input placeholder="Location (optional)" value={newSupplierAddress} onChange={(e) => setNewSupplierAddress(e.target.value)} />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setAddingSupplier(false)}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" loading={creatingSupplier} onClick={handleCreateSupplier}>
                    Save supplier
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Reference + date — de-emphasized meta strip */}
          <Card className="flex flex-wrap items-center gap-4 px-4 py-3">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-slate-400 dark:text-[#77857c]" />
              <span className="text-xs font-medium text-slate-500 dark:text-[#97a49b]">Reference #</span>
              <Input
                value={referenceNumber}
                onChange={(e) => {
                  setReferenceEdited(true);
                  setReferenceNumber(e.target.value);
                }}
                placeholder="auto-generated"
                className="w-56 py-1.5 text-sm"
              />
              {referenceEdited && (
                <button
                  type="button"
                  onClick={() => {
                    setReferenceEdited(false);
                    fetchNextReference();
                  }}
                  className="text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                >
                  Auto-generate
                </button>
              )}
            </div>
            <div className="h-5 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-slate-400 dark:text-[#77857c]" />
              <span className="text-xs font-medium text-slate-500 dark:text-[#97a49b]">Date</span>
              <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="w-40 py-1.5 text-sm" />
            </div>
          </Card>

          {/* Product block */}
          <Card>
            <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
              <IconChip tone="blue" icon={<Package size={17} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">
                Product <span className="font-semibold text-slate-400 dark:text-[#77857c]">({allLines.length})</span>
              </h3>
            </div>

            {!catalogLoading && products.length === 0 && (
              <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg bg-danger-50 px-3.5 py-2.5 text-[13px] text-danger-600">
                <Info size={15} className="flex-shrink-0" />
                {loadError
                  ? "Couldn't load the product catalog — check your connection and refresh the page."
                  : 'No products found yet — add some from the Products page first.'}
              </div>
            )}

            <div className="flex flex-col gap-4 px-5 pb-5">
              {sections.map((section) => (
                <div key={section.key} className="rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] bg-slate-50/40 p-3.5">
                  {/* Category — a header, not a row: pick it once per section */}
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <select
                        value={section.categoryKey}
                        onChange={(e) => setSectionCategory(section.key, e.target.value)}
                        disabled={products.length === 0}
                        className="cursor-pointer appearance-none border-none bg-transparent p-0 text-[13px] font-bold uppercase tracking-wide text-slate-600 dark:text-[#b6c2ba] focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                      >
                        <option value="">Select category…</option>
                        {categoryOptionsFor(section.key).map(([name]) => {
                          const catIdx = productGroups.findIndex(([n]) => n === name);
                          return (
                            <option key={name} value={name}>
                              {catIdx + 1}. {name}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown size={13} className="text-slate-400 dark:text-[#77857c]" />
                    </div>
                    {sections.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSection(section.key)}
                        className="text-slate-300 hover:text-danger-600"
                        title="Remove this category"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  {section.categoryKey && (
                    <>
                      <div
                        className="hidden pb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-[#77857c] sm:grid"
                        style={{ gridTemplateColumns: '24px minmax(0,1fr) 108px 130px 120px 28px', gap: '10px' }}
                      >
                        <span />
                        <span />
                        <span>Qty</span>
                        <span>Unit cost (TZS)</span>
                        <span className="text-right">Total (TZS)</span>
                        <span />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        {section.lines.map((line, idx) => (
                          <div
                            key={line.key}
                            className="grid min-w-[560px] items-center gap-2.5 rounded-lg bg-white dark:bg-[#121a16] py-1"
                            style={{ gridTemplateColumns: '24px minmax(0,1fr) 108px 130px 120px 28px' }}
                          >
                            <span className="text-center text-sm font-bold text-slate-400 dark:text-[#77857c]">{idx + 1}</span>
                            <Select
                              value={line.productId}
                              onChange={(e) => updateLine(section.key, line.key, { productId: e.target.value })}
                            >
                              <option value="">Product…</option>
                              {productsInCategory(section.categoryKey).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </Select>
                            <div className="flex items-center gap-1.5">
                              <Input
                                type="number"
                                min={1}
                                placeholder="Qty"
                                value={line.quantity}
                                onChange={(e) => updateLine(section.key, line.key, { quantity: e.target.value })}
                                className="w-full"
                              />
                              <span className="whitespace-nowrap rounded-md border border-slate-100 dark:border-[rgba(255,255,255,0.08)] bg-slate-50 px-1.5 py-1.5 text-[11px] font-semibold text-slate-400 dark:text-[#77857c]">
                                {unitFor(line.productId) ?? '—'}
                              </span>
                            </div>
                            <Input
                              type="number"
                              min={0}
                              placeholder="Unit cost"
                              value={line.unitCost}
                              onChange={(e) => updateLine(section.key, line.key, { unitCost: e.target.value })}
                            />
                            <span className="text-right text-sm font-semibold text-slate-700 dark:text-[#d2dbd5]">
                              {tzs((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeLine(section.key, line.key)}
                              className="justify-self-center text-slate-300 hover:text-danger-600"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => addLine(section.key)}
                        className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-700 hover:text-blue-800"
                      >
                        <Plus size={13} /> Add item
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="px-5 pb-5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Plus size={14} />}
                onClick={addSection}
                disabled={!canAddSection}
              >
                Add product category
              </Button>
              {!canAddSection && products.length > 0 && (
                <p className="mt-1 text-[11.5px] text-slate-400 dark:text-[#77857c]">
                  Every category is already in this purchase — add more items inside it above.
                </p>
              )}
            </div>
          </Card>

          {/* Expenses block */}
          <Card>
            <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
              <IconChip tone="amber" icon={<Banknote size={17} />} />
              <div>
                <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Cost to land this stock</h3>
                <p className="text-xs text-slate-400 dark:text-[#77857c]">Spread across the items above — feeds inventory value &amp; profit.</p>
              </div>
            </div>

            {costLines.length === 0 ? (
              <div className="mx-5 mb-2 rounded-xl border border-dashed border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-slate-50/70 px-4 py-6 text-center">
                <p className="text-[13px] text-slate-500 dark:text-[#97a49b]">No extra costs yet — add labour, transport, etc. if this delivery had any.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 px-5">
                {costLines.map((c) => (
                  <div key={c.key} className="flex flex-wrap items-center gap-2.5">
                    <Select
                      value={c.type}
                      onChange={(e) => updateCostLine(c.key, { type: e.target.value as ExpenseTypeOption | '' })}
                      className="min-w-[160px] flex-1"
                    >
                      <option value="">Type…</option>
                      {EXPENSE_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    {c.type === 'OTHER' && (
                      <Input
                        placeholder="Describe this cost"
                        value={c.customLabel}
                        onChange={(e) => updateCostLine(c.key, { customLabel: e.target.value })}
                        className="min-w-[160px] flex-1"
                      />
                    )}
                    <Input
                      type="number"
                      min={0}
                      placeholder="Amount (TZS)"
                      value={c.amount}
                      onChange={(e) => updateCostLine(c.key, { amount: e.target.value })}
                      className="w-36 flex-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeCostLine(c.key)}
                      className="flex-none text-slate-300 hover:text-danger-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="px-5 py-4">
              <Button type="button" variant="ghost" size="sm" icon={<Plus size={14} />} onClick={addCostLine}>
                Add expense
              </Button>
            </div>
          </Card>

          {/* Notes */}
          <Card className="p-5">
            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-[#97a49b]">
              Notes <span className="font-normal text-slate-400 dark:text-[#77857c]">(optional)</span>
            </label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this delivery…" />
          </Card>

          {/* Attach invoice/quotation (2026-09-14, CLAUDE.md #68; PDF
              support added same day) — one attachment per purchase,
              optional: a photo (resized client-side, see
              resizeDocumentPhoto above) or a PDF (read as-is, capped at
              2MB — see readPdfAsDataUrl), either way stored as a base64
              data: URL, same pattern as the user avatar photo. */}
          <Card className="p-5">
            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-[#97a49b]">
              Supplier invoice / quotation <span className="font-normal text-slate-400 dark:text-[#77857c]">(optional)</span>
            </label>
            {documentDataUrl ? (
              <div className="flex items-center gap-3">
                {isPdfDataUrl(documentDataUrl) ? (
                  <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-[rgba(255,255,255,0.14)] dark:bg-[#101914]">
                    <FileText size={28} className="text-red-500" />
                  </div>
                ) : (
                  <img
                    src={documentDataUrl}
                    alt="Attached invoice/quotation"
                    className="h-20 w-20 flex-shrink-0 rounded-lg border border-slate-200 object-cover dark:border-[rgba(255,255,255,0.14)]"
                  />
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-green-700 dark:text-green-400">
                    <Paperclip size={13} /> {isPdfDataUrl(documentDataUrl) ? 'PDF attached' : 'Photo attached'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDocumentDataUrl(null)}
                    className="flex items-center gap-1 text-[12.5px] font-medium text-red-600 hover:underline"
                  >
                    <X size={12} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 px-4 py-4 text-[12.5px] font-medium text-slate-500 hover:border-green-400 hover:text-green-700 dark:border-[rgba(255,255,255,0.14)] dark:text-[#97a49b]">
                {documentProcessing ? (
                  <span>Processing…</span>
                ) : (
                  <>
                    <Camera size={15} />
                    Attach a photo or PDF of the invoice/quotation
                  </>
                )}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  disabled={documentProcessing}
                  onChange={handleDocumentChange}
                />
              </label>
            )}
          </Card>
        </div>

        {/* RIGHT: summary + tip */}
        <div className="flex w-full flex-shrink-0 flex-col gap-5 lg:w-[340px]">
          <Card className="sticky top-4 p-5 shadow-panel">
            <div className="mb-4 flex items-center gap-2.5">
              <IconChip tone="green" icon={<ClipboardCheck size={17} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Purchase Summary</h3>
            </div>

            <div className="space-y-3 text-sm">
              {summarySections.length === 0 ? (
                <p className="text-[13px] text-slate-400 dark:text-[#77857c]">No items added yet.</p>
              ) : (
                summarySections.map(({ categoryKey, catIdx, entries }) => (
                  <div key={categoryKey}>
                    <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">
                      {catIdx + 1}. {categoryKey}
                    </p>
                    <div className="mt-1 space-y-1">
                      {entries.map(({ line, product }) => (
                        <div key={line.key} className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                          <span className="truncate pr-2">
                            {product.name} <span className="text-slate-400 dark:text-[#77857c]">× {line.quantity || 0}</span>
                          </span>
                          <span className="flex-shrink-0 font-medium text-slate-700 dark:text-[#d2dbd5]">
                            {tzs((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <div className="flex justify-between border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] pt-2 text-slate-500 dark:text-[#97a49b]">
                <span>Items subtotal</span>
                <span className="font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(itemsSubtotal)}</span>
              </div>
              {activeCostLines.map((c) => (
                <div key={c.key} className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                  <span>{labelFor(c)}</span>
                  <span className="font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(Number(c.amount))}</span>
                </div>
              ))}
            </div>

            <div className="my-3 h-px bg-slate-100 dark:bg-[#0e1512]" />

            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-bold text-slate-700 dark:text-[#d2dbd5]">Grand total</span>
              <span className="text-2xl font-extrabold text-green-700">{tzs(grandTotal)}</span>
            </div>

            <Button type="submit" form="purchase-form" className="mt-4 w-full" loading={submitting} icon={<ShoppingCart size={16} />}>
              Record purchase &amp; update stock
            </Button>
            <p className="mt-2 text-center text-[11.5px] text-slate-400 dark:text-[#77857c]">Stock updates the moment this is saved.</p>
          </Card>

          <div className="flex gap-3 rounded-xl bg-blue-50 p-4">
            <Info size={18} className="mt-0.5 flex-shrink-0 text-blue-600" />
            <p className="text-[12.5px] leading-snug text-slate-700 dark:text-[#d2dbd5]">
              Labour, transport and other landing costs are split across every item by its share of the subtotal — so unit
              cost, gross profit and inventory value stay accurate per product.
            </p>
          </div>
        </div>
      </form>

      <Card className="mt-5">
        <CardHeader
          title="Recent Purchases"
          subtitle="Last 50, newest first"
          action={
            <div className="relative w-full max-w-[220px]">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
              <Input
                placeholder="Search supplier or ref…"
                value={recentSearch}
                onChange={(e) => setRecentSearch(e.target.value)}
                className="py-1.5 pl-8 text-sm"
              />
            </div>
          }
        />
        {loadingRecent ? (
          <FullPageSpinner />
        ) : recentPurchases.length === 0 ? (
          <EmptyState title="No purchases recorded yet." />
        ) : filteredRecentPurchases.length === 0 ? (
          <EmptyState title="No purchases match this search." description="Try a different supplier name or reference number." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th>Reference</Th>
                <Th>Items</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </THead>
            <tbody>
              {filteredRecentPurchases.map((p) => (
                <Tr key={p.id}>
                  <Td>{formatDate(p.purchase_date)}</Td>
                  <Td className="text-slate-600 dark:text-[#b6c2ba]">{p.supplier_name ?? '—'}</Td>
                  <Td className="font-medium text-slate-800 dark:text-[#eef3ef]">
                    <span className="flex items-center gap-1.5">
                      {p.reference_number}
                      {p.has_document && <span title="Invoice/quotation attached"><Paperclip size={12} className="text-slate-400 dark:text-[#77857c]" /></span>}
                    </span>
                  </Td>
                  <Td className="text-slate-400 dark:text-[#77857c]">{p.item_count ?? p.items?.length ?? '—'}</Td>
                  <Td className="text-right font-medium">{tzs(p.total_cost)}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone="green">Completed</Badge>
                      {isOwner && pendingPurchaseIds.has(p.id) && <Badge tone="amber">Correction pending</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => openPurchase(p.id)} className="text-slate-400 dark:text-[#77857c] hover:text-blue-600" title="View details">
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => openEditModal(p.id)}
                        disabled={openingEditForId === p.id}
                        className="text-slate-400 dark:text-[#77857c] hover:text-amber-600 disabled:opacity-40"
                        title="Correct this purchase"
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* The "Pending Purchase Corrections" review queue moved to the
          Change Approval Center (2026-09-11, CLAUDE.md #35) — submitting a
          correction still happens here via the pencil icon above, but
          approving/rejecting it now happens on that page instead. */}

      <Modal open={viewPurchase !== null} onClose={() => setViewPurchase(null)} title={`Purchase ${viewPurchase?.reference_number ?? ''}`} size="lg">
        {viewPurchase && (
          <div>
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-sm text-slate-500 dark:text-[#97a49b]">
                {formatDate(viewPurchase.purchase_date)} — {viewPurchase.supplier_name}
              </p>
              {viewPurchase.document_data_url && (
                <a
                  href={viewPurchase.document_data_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-shrink-0 items-center gap-2 rounded-lg border border-slate-200 p-1 dark:border-[rgba(255,255,255,0.14)]"
                  title={`Open the attached invoice/quotation ${isPdfDataUrl(viewPurchase.document_data_url) ? 'PDF' : 'photo'}`}
                >
                  {isPdfDataUrl(viewPurchase.document_data_url) ? (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-50 dark:bg-[#101914]">
                      <FileText size={20} className="text-red-500" />
                    </div>
                  ) : (
                    <img src={viewPurchase.document_data_url} alt="Attached invoice/quotation" className="h-12 w-12 rounded object-cover" />
                  )}
                  <span className="flex items-center gap-1 pr-2 text-[12px] font-medium text-green-700 dark:text-green-400">
                    <Paperclip size={12} /> View
                  </span>
                </a>
              )}
            </div>
            <Table>
              <THead>
                <tr>
                  <Th>Product</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Unit Cost</Th>
                  <Th className="text-right">Allocated Cost</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </THead>
              <tbody>
                {viewPurchase.items?.map((item) => (
                  <Tr key={item.id}>
                    <Td>{item.product_name}</Td>
                    <Td className="text-right">{item.quantity}</Td>
                    <Td className="text-right">{tzs(item.unit_cost)}</Td>
                    <Td className="text-right">{tzs(item.allocated_additional_cost)}</Td>
                    <Td className="text-right font-medium">{tzs(item.total_cost)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-3 flex justify-end">
              <div className="w-64 space-y-1 text-sm">
                {viewPurchase.additional_cost_lines && viewPurchase.additional_cost_lines.length > 0 ? (
                  viewPurchase.additional_cost_lines.map((line) => (
                    <div key={line.id} className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                      <span>{line.label}</span>
                      <span>{tzs(line.amount)}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between text-slate-500 dark:text-[#97a49b]">
                    <span>Additional costs</span>
                    <span>{tzs(viewPurchase.additional_costs)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] pt-1 font-bold text-slate-800 dark:text-[#eef3ef]">
                  <span>Total</span>
                  <span>{tzs(viewPurchase.total_cost)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={editingPurchase !== null}
        onClose={closeEditModal}
        title={`Correct Purchase ${editingPurchase?.reference_number ?? ''}`}
        size="lg"
        footer={
          editingPurchase && (
            <>
              <Button type="button" variant="outline" onClick={closeEditModal}>
                Cancel
              </Button>
              <Button type="button" loading={submittingEdit} onClick={handleSubmitEdit}>
                {isOwner ? 'Save changes' : 'Send for approval'}
              </Button>
            </>
          )
        }
      >
        {editingPurchase && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-[#97a49b]">
              {formatDate(editingPurchase.purchase_date)} — {editingPurchase.supplier_name}. Only quantities, unit costs
              and expense amounts can be corrected here — not the supplier, date, or which items/expenses exist.
            </p>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Items</p>
              <div className="space-y-2">
                {editDraftItems.map((item) => (
                  <div key={item.purchaseItemId} className="grid grid-cols-[minmax(0,1fr)_110px_130px] items-center gap-2.5">
                    <span className="truncate text-sm text-slate-700 dark:text-[#d2dbd5]">{item.productName}</span>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateEditDraftItem(item.purchaseItemId, { quantity: e.target.value })}
                      />
                      <span className="whitespace-nowrap text-[11px] font-semibold text-slate-400 dark:text-[#77857c]">{item.unit}</span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      value={item.unitCost}
                      onChange={(e) => updateEditDraftItem(item.purchaseItemId, { unitCost: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </div>

            {editDraftCostLines.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Expenses</p>
                <div className="space-y-2">
                  {editDraftCostLines.map((line) => (
                    <div key={line.costLineId} className="flex items-center gap-2.5">
                      <span className="flex-1 truncate text-sm text-slate-700 dark:text-[#d2dbd5]">{line.label}</span>
                      <Input
                        type="number"
                        min={0}
                        value={line.amount}
                        onChange={(e) => updateEditDraftCostLine(line.costLineId, e.target.value)}
                        className="w-36 flex-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isOwner && (
              <FormField label="Reason for this change" hint="The owner sees this before deciding whether to approve.">
                <Textarea
                  rows={2}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="What was wrong, and what's being corrected?"
                />
              </FormField>
            )}

            {isOwner && (
              <p className="text-[12.5px] text-slate-400 dark:text-[#77857c]">Your own corrections apply immediately — no approval needed.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
