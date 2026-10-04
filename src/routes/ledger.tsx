import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/ledger")({
  head: () => ({
    meta: [
      { title: "Invoice Ledger — Invoice Decision Agent" },
      { name: "description", content: "Read-only ledger of vendor invoices, statuses, and live PO balances." },
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
  source: "seed" | "run";
  created_at: string;
  vendors: { name: string } | null;
  purchase_orders: { po_number: string; status: string } | null;
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
  vendors?: { name: string } | null;
};

const statusTone = (s: string) =>
  s === "approved" ? "decision-approve" : s === "review" ? "decision-review" : "decision-reject";

const money = (v: number) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function LedgerPage() {
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
      // 1. Invoices + vendors + POs (separate plain queries, no complex embeds)
      const [invRes, revRes, poRes, vendRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, vendor_id, po_id, run_id, invoice_number, invoice_date, total_amount, currency, status, source, created_at, vendors(name), purchase_orders(po_number,status)")
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

      // Build review actions map by run_id
      const revMap: Record<string, ReviewAction> = {};
      for (const r of (revRes.data ?? []) as ReviewAction[]) {
        if (r.run_id) revMap[r.run_id] = r;
      }

      // Build vendor map for PO table
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
      const poNum = po.po_number.toLowerCase();
      return vName.includes(q) || poNum.includes(q);
    });
  }, [poBalances, vendorsMap, query]);

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            <ArrowLeft className="size-4" /> Back to dashboard
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
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        <header className="mt-8">
          <p className="section-kicker">Accounting & Procurement</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Invoice Ledger & PO Balances</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete record of all processed invoices and active purchase order remaining balances.
          </p>
        </header>

        {error && <div className="error-inline mt-6"><span>{error}</span></div>}

        {loading ? (
          <div className="flex h-64 items-center justify-center"><LoaderCircle className="size-6 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* INVOICES TABLE */}
            <section className="mt-10">
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <p className="section-kicker">Ledger</p>
                  <h2 className="section-title">Invoices ({filteredInvoices.length})</h2>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[950px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/60 text-[11px] uppercase text-muted-foreground">
                        <th>Date</th>
                        <th>Vendor</th>
                        <th>Invoice No.</th>
                        <th className="text-right">Amount</th>
                        <th>PO</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Resolution / Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.length === 0 ? (
                        <tr><td colSpan={8} className="h-24 text-center text-muted-foreground">No invoices match the filter.</td></tr>
                      ) : (
                        filteredInvoices.map((inv) => {
                          const review = inv.run_id ? reviews[inv.run_id] : null;
                          const vName = inv.vendors?.name ?? inv.vendor_id ?? "Unknown vendor";
                          const poNum = inv.purchase_orders?.po_number;
                          const rowContent = (
                            <>
                              <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{inv.invoice_date ?? "—"}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); setQuery(vName); }}
                                  className="font-medium text-left hover:underline text-primary"
                                  title="Click to filter by vendor"
                                >
                                  {vName}
                                </button>
                              </td>
                              <td className="whitespace-nowrap font-mono text-xs font-medium">{inv.invoice_number}</td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums">${money(inv.total_amount)} {inv.currency ?? "USD"}</td>
                              <td className="whitespace-nowrap font-mono text-xs">
                                {poNum ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); setQuery(poNum); }}
                                    className="hover:underline text-primary"
                                    title="Click to filter by PO"
                                  >
                                    {poNum}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td>
                                <span className={`decision-badge ${statusTone(inv.status)}`}>{inv.status.toUpperCase()}</span>
                              </td>
                              <td><span className="signal-badge">{inv.source}</span></td>
                              <td>
                                {review ? (
                                  <span className="text-xs">
                                    <strong className="uppercase">{review.action}</strong> by {review.reviewer}: “{review.reason}”
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </td>
                            </>
                          );

                          return inv.run_id ? (
                            <tr
                              key={inv.id}
                              className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-muted/45"
                              onClick={() => window.location.href = `/runs/${inv.run_id}`}
                              title="Click to view run details"
                            >
                              {rowContent}
                            </tr>
                          ) : (
                            <tr key={inv.id} className="border-b border-border/70 last:border-0">
                              {rowContent}
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
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <p className="section-kicker">Procurement</p>
                  <h2 className="section-title">Purchase order balances ({filteredPOs.length})</h2>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/60 text-[11px] uppercase text-muted-foreground">
                        <th>PO Number</th>
                        <th>Vendor</th>
                        <th className="text-right">Total Amount</th>
                        <th className="text-right">Billed (Approved)</th>
                        <th className="text-right">Remaining</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPOs.length === 0 ? (
                        <tr><td colSpan={6} className="h-24 text-center text-muted-foreground">No purchase orders match the filter.</td></tr>
                      ) : (
                        filteredPOs.map((po) => {
                          const vName = vendorsMap[po.vendor_id] ?? po.vendor_id;
                          return (
                            <tr key={po.id} className="border-b border-border/70 last:border-0 hover:bg-muted/30">
                              <td className="whitespace-nowrap font-mono font-medium">
                                <button
                                  type="button"
                                  onClick={() => setQuery(po.po_number)}
                                  className="hover:underline text-primary"
                                  title="Click to filter by PO"
                                >
                                  {po.po_number}
                                </button>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => setQuery(vName)}
                                  className="text-left hover:underline text-primary"
                                  title="Click to filter by vendor"
                                >
                                  {vName}
                                </button>
                              </td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums">${money(po.total_amount)}</td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums">${money(po.billed_amount)}</td>
                              <td className="whitespace-nowrap text-right font-mono tabular-nums font-semibold">
                                <span className={po.remaining_amount < 0 ? "text-reject" : ""}>
                                  ${money(po.remaining_amount)}
                                </span>
                              </td>
                              <td>
                                <span className="signal-badge">{po.status}</span>
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
          </>
        )}
      </div>
    </main>
  );
}
