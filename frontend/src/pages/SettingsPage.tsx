import { FormEvent, useEffect, useState } from 'react';
import { Settings as SettingsIcon, Building2, Landmark, Percent, Smartphone, FileText } from 'lucide-react';
import { settingsApi, apiErrorMessage } from '../lib/api';
import { BusinessSettings } from '../types';
import { Button, Card, FormField, IconChip, Input, PageHeader, Textarea } from '../components/ui';
import { useToast } from '../components/ui/Toast';

// New Business Settings page (2026-09-12, Quotations feature, CLAUDE.md
// #49) — the very first UI for business_settings. Before this, the row
// could only ever be seeded, never edited: businessSettingsRepo.ts's
// updateBusinessSettings() existed in the original build but had no route
// or page calling it, which is why a printed Quotation had nowhere to pull
// real TIN/address/bank details from until now. Owner-only, since it edits
// the shop's own identity and payment details.
export default function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [tin, setTin] = useState('');
  const [defaultMaxDiscountPct, setDefaultMaxDiscountPct] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankSwift, setBankSwift] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [vatRatePct, setVatRatePct] = useState('');
  const [quotationValidityDays, setQuotationValidityDays] = useState('');
  const [mobileMoney1Number, setMobileMoney1Number] = useState('');
  const [mobileMoney1Label, setMobileMoney1Label] = useState('');
  const [mobileMoney2Number, setMobileMoney2Number] = useState('');
  const [mobileMoney2Label, setMobileMoney2Label] = useState('');
  // Standard invoice/quotation Terms text (2026-09-12, CLAUDE.md #54) — set
  // once here instead of retyped per sale via Sales History's Edit Sale.
  const [invoiceTerms, setInvoiceTerms] = useState('');

  useEffect(() => {
    settingsApi
      .get()
      .then((res) => {
        const s = res.data;
        setSettings(s);
        setBusinessName(s.business_name ?? '');
        setPhone(s.phone ?? '');
        setEmail(s.email ?? '');
        setAddress(s.address ?? '');
        setTin(s.tin ?? '');
        setDefaultMaxDiscountPct(String(s.default_max_discount_pct ?? ''));
        setBankAccountName(s.bank_account_name ?? '');
        setBankAccountNumber(s.bank_account_number ?? '');
        setBankName(s.bank_name ?? '');
        setBankSwift(s.bank_swift ?? '');
        setBankBranch(s.bank_branch ?? '');
        setVatRatePct(String(s.vat_rate_pct ?? ''));
        setQuotationValidityDays(String(s.quotation_validity_days ?? ''));
        setMobileMoney1Number(s.mobile_money_1_number ?? '');
        setMobileMoney1Label(s.mobile_money_1_label ?? '');
        setMobileMoney2Number(s.mobile_money_2_number ?? '');
        setMobileMoney2Label(s.mobile_money_2_label ?? '');
        setInvoiceTerms(s.invoice_terms ?? '');
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load business settings.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await settingsApi.update({
        businessName: businessName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        tin: tin.trim() || undefined,
        defaultMaxDiscountPct: defaultMaxDiscountPct ? Number(defaultMaxDiscountPct) : undefined,
        bankAccountName: bankAccountName.trim() || undefined,
        bankAccountNumber: bankAccountNumber.trim() || undefined,
        bankName: bankName.trim() || undefined,
        bankSwift: bankSwift.trim() || undefined,
        bankBranch: bankBranch.trim() || undefined,
        vatRatePct: vatRatePct ? Number(vatRatePct) : undefined,
        quotationValidityDays: quotationValidityDays ? Number(quotationValidityDays) : undefined,
        mobileMoney1Number: mobileMoney1Number.trim() || undefined,
        mobileMoney1Label: mobileMoney1Label.trim() || undefined,
        mobileMoney2Number: mobileMoney2Number.trim() || undefined,
        mobileMoney2Label: mobileMoney2Label.trim() || undefined,
        invoiceTerms: invoiceTerms.trim() || undefined,
      });
      setSettings(res.data);
      toast.success('Settings saved.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save settings.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 dark:text-[#77857c]">
        <SettingsIcon size={18} className="mr-2 animate-pulse" /> Loading settings…
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={<SettingsIcon size={20} />}
        title="Business Settings"
        subtitle="Your shop's official details — used on printed receipts and quotations."
      />

      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-5">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <IconChip tone="blue" size={30} icon={<Building2 size={14} />} />
            <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Business Information</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Business Name">
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
            </FormField>
            <FormField label="TIN Number">
              <Input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="e.g. 123-456-789" />
            </FormField>
            <FormField label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XXXXXXXX" />
            </FormField>
            <FormField label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Address" hint="Shown on receipts and quotations.">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city" />
            </FormField>
          </div>
        </Card>

        {/* Standard invoice/quotation Terms text (2026-09-12, CLAUDE.md
            #54) — set once here, like Bank Details, instead of retyped per
            sale. Falls back to this only when a specific sale/quotation
            has no note of its own. */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <IconChip tone="blue" size={30} icon={<FileText size={14} />} />
            <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Invoice Terms</h3>
            <span className="text-xs text-slate-400 dark:text-[#77857c]">Standard note printed on every invoice/quotation, unless a specific sale has its own.</span>
          </div>
          <FormField label="Terms / Notes" hint='e.g. "Payment is due in advance. If you have any question concerning this invoice, please do not hesitate to contact us."'>
            <Textarea rows={3} value={invoiceTerms} onChange={(e) => setInvoiceTerms(e.target.value)} />
          </FormField>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <IconChip tone="green" size={30} icon={<Landmark size={14} />} />
            <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Bank Details</h3>
            <span className="text-xs text-slate-400 dark:text-[#77857c]">Printed on quotations under "Bank Details" — namba za malipo.</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Account Name">
              <Input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} />
            </FormField>
            <FormField label="Account Number">
              <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
            </FormField>
            <FormField label="Bank Name">
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </FormField>
            <FormField label="SWIFT Code">
              <Input value={bankSwift} onChange={(e) => setBankSwift(e.target.value)} />
            </FormField>
            <FormField label="Branch">
              <Input value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
            </FormField>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <IconChip tone="green" size={30} icon={<Smartphone size={14} />} />
            <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Mobile Money</h3>
            <span className="text-xs text-slate-400 dark:text-[#77857c]">Shown on a receipt/invoice when a balance is still owed.</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Number 1">
              <Input value={mobileMoney1Number} onChange={(e) => setMobileMoney1Number(e.target.value)} placeholder="+255 6XX XXX XXX" />
            </FormField>
            <FormField label="Network / Label 1" hint="e.g. M-Pesa, Tigo Pesa">
              <Input value={mobileMoney1Label} onChange={(e) => setMobileMoney1Label(e.target.value)} />
            </FormField>
            <FormField label="Number 2">
              <Input value={mobileMoney2Number} onChange={(e) => setMobileMoney2Number(e.target.value)} placeholder="+255 7XX XXX XXX" />
            </FormField>
            <FormField label="Network / Label 2" hint="e.g. Airtel Money, HaloPesa">
              <Input value={mobileMoney2Label} onChange={(e) => setMobileMoney2Label(e.target.value)} />
            </FormField>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <IconChip tone="amber" size={30} icon={<Percent size={14} />} />
            <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Sales Defaults</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Max Discount % (sales role limit)">
              <Input type="number" min={0} max={100} step="0.01" value={defaultMaxDiscountPct} onChange={(e) => setDefaultMaxDiscountPct(e.target.value)} />
            </FormField>
            <FormField label="VAT Rate %" hint="Used on Quotations.">
              <Input type="number" min={0} max={100} step="0.01" value={vatRatePct} onChange={(e) => setVatRatePct(e.target.value)} />
            </FormField>
            <FormField label="Quotation Validity (days)" hint="Default 'Valid Until' offset.">
              <Input type="number" min={1} value={quotationValidityDays} onChange={(e) => setQuotationValidityDays(e.target.value)} />
            </FormField>
          </div>
        </Card>

        <div>
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
