import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, Search, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { API_BASE_URL } from "@/config";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Invoice Decision Agent" },
      { name: "description", content: "Review invoice decision runs and start a new PDF analysis." },
      { property: "og:title", content: "Invoice Decision Agent" },
      { property: "og:description", content: "PDF invoice in, clear decision and reasons out." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type Run = {
  id: string;
  file_name: string;
  status: "queued" | "running" | "completed" | "failed";
  decision: "APPROVE" | "REVIEW" | "REJECT" | null;
  summary: string | null;
  error: string | null;
  match_type: string | null;
  created_at: string;
  invoice_number: string | null;
  invoice_number_clean: string | null;
  vendor_raw: string | null;
  po_printed: string | null;
  vendors: { name: string } | null;
  purchase_orders: { po_number: string } | null;
};

type ApiState = "waking" | "online" | "unreachable";

// Columns for the run history. The arrows read single values out of the run's
// standardized invoice (JSON); vendors(...) and purchase_orders(...) join the matched
// vendor and PO. All read-only, with the public browser key.
const RUN_COLUMNS = [
  "id", "file_name", "status", "decision", "summary", "error", "match_type", "created_at",
  "invoice_number:normalized_json->>invoice_number_raw",
  "invoice_number_clean:normalized_json->>cleaned_invoice_number",
  "vendor_raw:normalized_json->>vendor_name_raw",
  "po_printed:normalized_json->>po_number",
  "vendors(name)",
  "purchase_orders(po_number)",
].join(",");

async function errorDetail(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

// "NW-5601", "nw 5601" and "NW5601" should all find the same invoice.
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function matchesQuery(run: Run, query: string): boolean {
  const lower = query.toLowerCase();
  const short = compact(query);
  const fields = [
    run.file_name, run.summary, run.error, run.vendors?.name, run.vendor_raw,
    run.invoice_number, run.invoice_number_clean, run.purchase_orders?.po_number, run.po_printed,
  ];
  return fields.some((field) => {
    if (!field) return false;
    return field.toLowerCase().includes(lower) || (short.length > 0 && compact(field).includes(short));
  });
}

const fmtWhen = (s: string) =>
  new Date(s).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Dashboard() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [apiState, setApiState] = useState<ApiState>("waking");
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "APPROVE" | "REVIEW" | "REJECT" | "FAILED">("ALL");
  const [query, setQuery] = useState("");

  const checkHealth = useCallback(async () => {
    setApiState("waking");
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (!response.ok) throw new Error(await errorDetail(response));
      setApiState("online");
    } catch {
      setApiState("unreachable");
    }
  }, []);

  const loadRuns = useCallback(async () => {
    const { data, error } = await supabase
      .from("runs")
      .select(RUN_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      setRunsError(error.message);
      return;
    }
    setRunsError(null);
    setRuns((data ?? []) as unknown as Run[]);
  }, []);

  useEffect(() => {
    void checkHealth();
    void loadRuns();
    const channel = supabase
      .channel("runs-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, () => void loadRuns())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [checkHealth, loadRuns]);

  const uploadPdf = async (file?: File) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please choose a PDF file");
      return;
    }
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch(`${API_BASE_URL}/runs`, { method: "POST", body });
      if (!response.ok) throw new Error(await errorDetail(response));
      const result = (await response.json()) as { run_id: string };
      await navigate({ to: "/runs/$id", params: { id: result.run_id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload invoice");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const counts = useMemo(
    () => ({
      APPROVE: runs.filter((run) => run.decision === "APPROVE").length,
      REVIEW: runs.filter((run) => run.decision === "REVIEW").length,
      REJECT: runs.filter((run) => run.decision === "REJECT").length,
      FAILED: runs.filter((run) => run.status === "failed").length,
    }),
    [runs],
  );

  const visibleRuns = useMemo(() => {
    const q = query.trim();
    return runs.filter((run) => {
      if (filter === "FAILED" ? run.status !== "failed" : filter !== "ALL" && run.decision !== filter) return false;
      return !q || matchesQuery(run, q);
    });
  }, [runs, filter, query]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-5 py-7 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <div className="flex items-center gap-4">
            <div className="brand-mark" aria-hidden="true"><span /><span /></div>
            <div>
              <h1 className="font-display text-2xl font-semibold sm:text-3xl">Invoice Decision Agent</h1>
              <p className="mt-1 text-sm text-muted-foreground">PDF invoice in → APPROVE / REVIEW / REJECT with reasons out</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
            <span className={`status-pill api-${apiState}`}>
              <StatusDot state={apiState} />
              {apiState === "waking" ? "API waking up..." : apiState === "online" ? "API online" : "API unreachable"}
            </span>
            {apiState === "unreachable" && (
              <Button variant="outline" size="sm" onClick={() => void checkHealth()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12 lg:py-12">
        <section aria-labelledby="new-run-title">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div><p className="section-kicker">Workspace</p><h2 id="new-run-title" className="section-title">New run</h2></div>
            <p className="hidden text-sm text-muted-foreground sm:block">Upload a vendor invoice PDF (max 10 MB)</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-6 lg:p-8">
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => void uploadPdf(event.target.files?.[0])} />
            <button
              type="button"
              className={`drop-zone ${dragging ? "drop-zone-active" : ""}`}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadPdf(event.dataTransfer.files[0]); }}
            >
              {busy ? <LoaderCircle className="size-6 animate-spin text-primary" /> : <UploadCloud className="size-6 text-primary" />}
              <span className="font-medium">Drop one PDF here</span><span className="text-xs text-muted-foreground">or click to browse</span>
            </button>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="history-title">
          <div className="mb-5 flex items-end justify-between"><div><p className="section-kicker">Latest activity</p><h2 id="history-title" className="section-title">Run history</h2></div><span className="text-xs text-muted-foreground">Last 50 runs · live</span></div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter runs">
              {([["ALL", "All", runs.length], ["APPROVE", "Approve", counts.APPROVE], ["REVIEW", "Review", counts.REVIEW], ["REJECT", "Reject", counts.REJECT], ["FAILED", "Failed", counts.FAILED]] as const).map(([key, label, n]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${filter === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted"}`}>
                  {label}<span className="font-mono opacity-75">{n}</span>
                </button>
              ))}
            </div>
            <label className="relative block sm:w-96">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vendor, invoice no., PO, file or summary" aria-label="Search runs" className="h-9 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {runsError ? <div className="error-inline m-5"><span>{runsError}</span><Button size="sm" variant="outline" onClick={() => void loadRuns()}>Retry</Button></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
                  <thead><tr className="border-b border-border bg-muted/60 text-[11px] uppercase text-muted-foreground"><th>Time</th><th>File name</th><th>Vendor</th><th>Invoice no.</th><th>PO</th><th>Status</th><th>Decision</th><th>Summary</th></tr></thead>
                  <tbody>
                    {visibleRuns.length === 0 ? <tr><td colSpan={8} className="h-28 text-center text-muted-foreground">{runs.length === 0 ? "No runs found" : "No runs match these filters"}</td></tr> : visibleRuns.map((run) => (
                      <tr key={run.id} tabIndex={0} className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-muted/45 focus-visible:bg-muted focus-visible:outline-none" onClick={() => void navigate({ to: "/runs/$id", params: { id: run.id } })} onKeyDown={(event) => { if (event.key === "Enter") void navigate({ to: "/runs/$id", params: { id: run.id } }); }}>
                        <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmtWhen(run.created_at)}</td>
                        <td><span className="block max-w-48 truncate font-medium" title={run.file_name}>{run.file_name}</span></td>
                        <td><VendorCell run={run} /></td>
                        <td className="whitespace-nowrap font-mono text-xs">{run.invoice_number ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="whitespace-nowrap font-mono text-xs"><PoCell run={run} /></td>
                        <td><span className={`run-status run-${run.status}`}>{run.status}</span></td>
                        <td><DecisionBadge decision={run.decision} /></td>
                        <td><span className="block max-w-[360px] truncate text-muted-foreground" title={run.summary || run.error || ""}>{run.summary || run.error || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusDot({ state }: { state: ApiState }) {
  const color = state === "online" ? "bg-approve" : state === "waking" ? "bg-review" : "bg-reject";
  return (
    <span className="relative inline-flex size-2" aria-hidden="true">
      {state === "online" && <span className={`absolute inline-flex size-full animate-ping rounded-full ${color} opacity-75`} />}
      <span className={`relative inline-flex size-2 rounded-full ${color}`} />
    </span>
  );
}

function VendorCell({ run }: { run: Run }) {
  if (run.vendors?.name) return <span className="block max-w-48 truncate" title={run.vendors.name}>{run.vendors.name}</span>;
  if (run.vendor_raw) return <span className="block max-w-48 truncate text-muted-foreground" title="Not matched to the vendor list">{run.vendor_raw}</span>;
  return <span className="text-muted-foreground">—</span>;
}

function PoCell({ run }: { run: Run }) {
  if (run.purchase_orders?.po_number) {
    return <>{run.purchase_orders.po_number}{run.match_type === "implied" && <span className="ml-1 text-muted-foreground">(implied)</span>}</>;
  }
  if (run.po_printed) return <span className="text-reject" title="Printed on the invoice, but not in the PO list">{run.po_printed} (not found)</span>;
  return <span className="text-muted-foreground">—</span>;
}

function DecisionBadge({ decision }: { decision: Run["decision"] }) {
  return <span className={`decision-badge decision-${decision?.toLowerCase() || "none"}`}>{decision || "NONE"}</span>;
}
