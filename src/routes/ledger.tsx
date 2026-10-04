import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/ledger")({
  head: () => ({
    meta: [
      { title: "Invoice Ledger — Invoice Decision Agent" },
      { name: "description", content: "Read-only ledger of vendor invoices and live PO balances." },
    ],
  }),
  component: LedgerPage,
});

type InvoiceRow = {
  id: string;
  vendor_id: string | null;
  po_id: string | null;
  run_id: string | null;
  invoice_number: string;
  invoice_date: string | null;
  total_amount: number;
  currency: string | null;
  status: "approved" | "review" | "rejected";
  created_at: string;
  vendors: { name: string } | null;
  purchase_orders: { po_number: string } | null;
};

type ReviewAction = {
  run_id: string;
  action: "approve" | "reject";
  reviewer: string;
  reason: string;
  created_at: string;
};

type PoBalance = {
  id: string;
  po_number: string;
  vendor_id: string;
  total_amount: number;
  currency: string;
  status: string;
  billed_amount: number;
  remaining_amount: number;
};

// "$2,406.00" for USD (or no currency), "7,226.00 RS." for anything else.
// Negative amounts read "-$300.00", never "$-300.00".
function formatAmount(value: number, currency: string | null): string {
  const n = Number(value);
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "-" : "";
  const isUsd = !currency || currency.toUpperCase() === "USD";
  return isUsd ? `${sign}$${abs}` : `${sign}${abs} ${currency}`;
}

function LedgerPage() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewAction>>({});
  const [poBalances, setPoBalances] = useState<PoBalance[]>([]);
  const [vendorsMap, setVendorsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadData = useCallback(async () => {
    setError(null);
    try {
      // Separate plain queries; review_actions is joined in code by run_id (no nested embed).
      const [invRes, revRes, poRes, vendRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, vendor_id, po_id, run_id, invoice_number, invoice_date, total_amount, currency, status, created_at, vendors(name), purchase_orders(po_number)")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("review_actions").select("run_id, action, reviewer, reason, created_at").limit(200),
        supabase.from("po_balances").select("*").order("po_number"),
        supabase.from("vendors").select("id, name"),
      ]);

      if (invRes.error) throw new Error(invRes.error.message);
      if (revRes.error) throw new Error(revRes.error.message);
      if (poRes.error) throw new Error(poRes.error.message);
      if (vendRes.error) throw new Error(vendRes.error.message);

      const revMap: Record<string, ReviewAction> = {};
      for (const r of (revRes.data ?? []) as ReviewAction[]) {
        if (r.run_id) revMap[r.run_id] = r;
      }
      const vMap: Record<string, string> = {};
      for (const v of (vendRes.data ?? []) as { id: string; name: string }[]) {
        vMap[v.id] = v.name;
      }

      setInvoices((invRes.data ?? []) as unknown as InvoiceRow[]);
      setReviews(revMap);
      setPoBalances((poRes.data ?? []) as PoBalance[]);
      setVendorsMap(vMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ledger data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  // Money waiting for a human, per PO. REVIEW invoices do NOT reduce the PO's remaining
  // balance (only approved ones do), so this shows the exposure that is not yet counted.
  const inReviewByPo = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const inv of invoices) {
      if (inv.status === "review" && inv.po_id) {
        totals[inv.po_id] = (totals[inv.po_id] ?? 0) + Number(inv.total_amount);
      }
    }
    return totals;
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const vName = inv.vendors?.name?.toLowerCase() ?? "";
      const poNum = inv.purchase_orders?.po_number?.toLowerCase() ?? "";
      const invNo = inv.invoice_number.toLowerCase();
      return vName.includes(q) || poNum.includes(q) || invNo.includes(q) || inv.status.includes(q);
    });
  }, [invoices, query]);

  const filteredPOs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return poBalances;
    return poBalances.filter((po) => {
      const vName = (vendorsMap[po.vendor_id] ?? "").toLowerCase();
      return vName.includes(q) || po.po_number.toLowerCase().includes(q);
    });
  }, [poBalances, vendorsMap, query]);

  const openRun = (runId: string) => void navigate({ to: "/runs/$id", params: { id: runId } });

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="group inline-flex items-center gap-2 text-sm font-medium text-link hover:underline">
            <ArrowLeft className="size-4 transition-transform duration-200 ease-out group-hover:-translate-x-[3px]" /> Back to dashboard
          </Link>
          <div className="flex items-center gap-3">
            <label className="relative block sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by vendor, invoice no., or PO"
                aria-label="Filter ledger"
                className="h-9 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="press inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        <header className="mt-8">
          <p className="section-kicker">Accounting & Procurement</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Invoice Ledger & PO Balances</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every recorded invoice, and how much is left on each purchase order. Click a vendor or PO to filter.
          </p>
        </header>

        {error && <div className="error-inline mt-6"><span>{error}</span></div>}

        {loading ? (
          <div className="flex h-64 items-center justify-center"><LoaderCircle className="size-6 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* INVOICES TABLE */}
            <section className="mt-10">
              <div className="mb-4">
                <p className="section-kicker">Ledger</p>
                <h2 className="section-title">Invoices ({filteredInvoices.length})</h2>
              </div>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/60 text-[11px] uppercase text-muted-foreground">
                        <th>Date</th>
                        <th>Vendor</th>
                        <th>Invoice No.</th>
                        <th className="text-right">Amount</th>
                        <th>PO</th>
                        <th>Reviewer decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.length === 0 ? (
                        <tr><td colSpan={6} className="h-24 text-center text-muted-foreground">No invoices match the filter.</td></tr>
                      ) : (
                        filteredInvoices.map((inv) => {
                          const review = inv.run_id ? reviews[inv.run_id] : undefined;
                          const vName = inv.vendors?.name ?? "Unknown vendor";
                          const poNum = inv.purchase_orders?.po_number;
                          const runId = inv.run_id;
                          return (
                            <tr
                              key={inv.id}
                              tabIndex={runId ? 0 : undefined}
                              className={`border-b border-border/70 last:border-0 ${runId ? "cursor-pointer transition-colors hover:bg-muted/45 focus-visible:bg-muted focus-visible:outline-none" : ""}`}
                              onClick={runId ? () => openRun(runId) : undefined}
                              onKeyDown={runId ? (e) => { if (e.key === "Enter") openRun(runId); } : undefined}
                              title={runId ? "Click to view run details" : "Pre-existing ledger entry (no run)"}
                            >
                              <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{inv.invoice_date ?? "—"}</td>
                              <td>
                                {inv.vendors?.name ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setQuery(vName); }}
                                    className="text-left font-medium text-link hover:underline"
                                    title="Filter by this vendor"
                                  >
                                    {vName}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">{vName}</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap font-mono text-xs font-medium">{inv.invoice_number}</td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums">{formatAmount(inv.total_amount, inv.currency)}</td>
                              <td className="whitespace-nowrap font-mono text-xs">
                                {poNum ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setQuery(poNum); }}
                                    className="text-link hover:underline"
                                    title="Filter by this PO"
                                  >
                                    {poNum}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td>
                                {review ? (
                                  <span className="text-xs">
                                    <strong className={`uppercase ${review.action === "approve" ? "text-approve" : "text-reject"}`}>{review.action}</strong> by {review.reviewer}: “{review.reason}”
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* PO BALANCES TABLE */}
            <section className="mt-12">
              <div className="mb-4">
                <p className="section-kicker">Procurement</p>
                <h2 className="section-title">Purchase order balances ({filteredPOs.length})</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Remaining = total minus APPROVED invoices. "In review" is money waiting for a human; it does not reduce the remaining balance yet.
                </p>
              </div>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/60 text-[11px] uppercase text-muted-foreground">
                        <th>PO Number</th>
                        <th>Vendor</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Billed (approved)</th>
                        <th className="text-right">Remaining</th>
                        <th className="text-right">In review</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPOs.length === 0 ? (
                        <tr><td colSpan={7} className="h-24 text-center text-muted-foreground">No purchase orders match the filter.</td></tr>
                      ) : (
                        filteredPOs.map((po) => {
                          const vName = vendorsMap[po.vendor_id] ?? po.vendor_id;
                          const remaining = Number(po.remaining_amount);
                          const inReview = inReviewByPo[po.id] ?? 0;
                          return (
                            <tr key={po.id} className="border-b border-border/70 last:border-0 hover:bg-muted/30">
                              <td className="whitespace-nowrap font-mono font-medium">
                                <button type="button" onClick={() => setQuery(po.po_number)} className="text-link hover:underline" title="Filter by this PO">
                                  {po.po_number}
                                </button>
                              </td>
                              <td>
                                <button type="button" onClick={() => setQuery(vName)} className="text-left text-link hover:underline" title="Filter by this vendor">
                                  {vName}
                                </button>
                              </td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums">{formatAmount(po.total_amount, po.currency)}</td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums">{formatAmount(po.billed_amount, po.currency)}</td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums font-semibold">
                                <span className={remaining < 0 ? "text-reject" : ""}>{formatAmount(remaining, po.currency)}</span>
                                {remaining < 0 && <span className="block text-[0.65rem] font-medium text-reject">over-billed</span>}
                              </td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums">
                                {inReview > 0 ? <span className="font-semibold text-review">{formatAmount(inReview, po.currency)}</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td><span className="signal-badge">{po.status}</span></td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
