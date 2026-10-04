import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, Circle, LoaderCircle, Minus, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { API_BASE_URL } from "@/config";
import { InvoiceDetails } from "@/components/InvoiceDetails";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/runs/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Run ${params.id} — Invoice Decision Agent` },
      { name: "description", content: "Decision, pipeline stages and business rule results for an invoice run." },
      { property: "og:title", content: "Invoice run — Invoice Decision Agent" },
      { property: "og:description", content: "Decision, pipeline stages and business rule results for an invoice run." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RunPage,
});

type Json = unknown;
type Run = {
  id: string; file_name: string | null; status: string; decision: string | null; summary: string | null; error: string | null;
  used_cache: boolean | null; extraction_path: string | null; match_type: string | null; created_at: string; updated_at: string;
};
type Stage = {
  id: string; stage_order: number; stage_name: string; status: string; input_data: Json; output_data: Json;
  message: string | null; started_at: string | null; finished_at: string | null;
};
type Rule = { rule_order: number; rule_name: string; status: string; expected_value: Json; actual_value: Json; message: string | null };
type ReviewAction = {
  id: number; action: "approve" | "reject"; reviewer: string; reason: string;
  previous_status: string | null; new_status: string | null; created_at: string;
};
type Ledger = { id: string; status: string; vendor_id: string | null; po_id: string | null };

const STAGE_LABELS: Record<string, string> = {
  intake: "Receive file", text_extraction: "Read text layer", ai_extraction: "AI reads the invoice", normalization: "Standardize values",
  validation: "Validate the document", matching: "Match vendor and PO", rules: "Apply business rules", decision: "Decide",
  explanation: "Explain the decision", persist: "Save to ledger",
};
const RULE_LABELS: Record<string, string> = {
  is_invoice: "Document is an invoice", required_fields: "Required fields present", math_consistency: "Amounts add up", evidence_check: "Values found in PDF text", invoice_date_check: "Invoice date not in the future",
  vendor_known: "Vendor on vendor list", vendor_active: "Vendor is active", po_found: "Purchase order found",
  po_belongs_to_vendor: "PO belongs to this vendor", po_open: "PO is open", currency_match: "Currency matches PO",
  po_balance_check: "Fits PO remaining balance", duplicate_check: "Not a duplicate", implied_match_flag: "PO printed (not inferred)",
};

// Reviewer secret and name are kept only for this browser tab (sessionStorage), never in the code.
const SECRET_KEY = "zampReviewerSecret";
const NAME_KEY = "zampReviewerName";
const MIN_REASON = 5; // the backend enforces the same minimum

const asObj = (v: Json): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const show = (v: Json) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));
const fmtTime = (s: string) => new Date(s).toLocaleString();
const humanLabel = (a: ReviewAction["action"]) => (a === "approve" ? "APPROVED" : "REJECTED");
const humanTone = (a: ReviewAction["action"]) => (a === "approve" ? "decision-approve" : "decision-reject");

function RunPage() {
  const { id } = Route.useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRunAndStages = useCallback(async () => {
    const [r, s] = await Promise.all([
      supabase.from("runs").select("*").eq("id", id).maybeSingle(),
      supabase.from("run_stages").select("*").eq("run_id", id).order("stage_order"),
    ]);
    if (r.error) return setError(r.error.message);
    if (s.error) return setError(s.error.message);
    if (!r.data) return setError("Run not found");
    setError(null);
    setRun(r.data as Run);
    setStages((s.data ?? []) as Stage[]);
  }, [id]);

  const fetchRules = useCallback(async () => {
    const { data, error: e } = await supabase.from("rule_results").select("*").eq("run_id", id).order("rule_order");
    if (e) setError(e.message);
    else setRules((data ?? []) as Rule[]);
  }, [id]);

  const fetchReview = useCallback(async () => {
    const [a, l] = await Promise.all([
      supabase.from("review_actions").select("*").eq("run_id", id).limit(1),
      supabase.from("invoices").select("id,status,vendor_id,po_id").eq("run_id", id).limit(1),
    ]);
    if (a.error) return setError(a.error.message);
    if (l.error) return setError(l.error.message);
    setAction((((a.data ?? [])[0] as ReviewAction | undefined) ?? null));
    setLedger((((l.data ?? [])[0] as Ledger | undefined) ?? null));
  }, [id]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchRunAndStages(), fetchRules(), fetchReview()]);
    setRefreshing(false);
    setLoading(false);
  }, [fetchRunAndStages, fetchRules, fetchReview]);

  useEffect(() => {
    void refreshAll();
    const channel = supabase
      .channel(`run-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `id=eq.${id}` }, () => void fetchRunAndStages())
      .on("postgres_changes", { event: "*", schema: "public", table: "run_stages", filter: `run_id=eq.${id}` }, () => void fetchRunAndStages())
      .on("postgres_changes", { event: "*", schema: "public", table: "review_actions", filter: `run_id=eq.${id}` }, () => void fetchReview())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [id, refreshAll, fetchRunAndStages, fetchReview]);

  // Re-fetch rules (and the ledger row) when the rules stage finishes or the run terminates
  const rulesStatus = stages.find((s) => s.stage_name === "rules")?.status;
  const trigger = `${rulesStatus === "done" || rulesStatus === "warn" ? "rules-ok" : ""}|${run?.status === "completed" || run?.status === "failed" ? run.status : ""}`;
  const lastTrigger = useRef(trigger);
  useEffect(() => {
    if (trigger !== lastTrigger.current) { lastTrigger.current = trigger; void fetchRules(); void fetchReview(); }
  }, [trigger, fetchRules, fetchReview]);

  const explanation = asObj(stages.find((s) => s.stage_name === "explanation")?.output_data);
  const deciding = asList(explanation?.["deciding_rules"]).map(String);

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="group inline-flex items-center gap-2 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4 transition-transform duration-200 ease-out group-hover:-translate-x-[3px]" />Back to dashboard</Link>
          <button onClick={() => void refreshAll()} disabled={refreshing} className="press inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center"><LoaderCircle className="size-6 animate-spin" /></div>
        ) : !run ? (
          <div className="error-inline mt-10">{error ?? "Run not found"}</div>
        ) : (
          <>
            {error && <div className="error-inline mt-6">{error}</div>}
            <Header run={run} />
            <DecisionCard run={run} stages={stages} explanation={explanation} action={action} />
            {run.status === "completed" && run.decision === "REVIEW" && (
              action ? <ResolvedCard action={action} /> : <ReviewPanel run={run} ledger={ledger} onResolved={() => void fetchReview()} />
            )}
            <Pipeline stages={stages} />
            {rules.length > 0 && <RulesTable rules={rules} deciding={deciding} />}
            <InvoiceDetails outputs={Object.fromEntries(stages.map((s) => [s.stage_name, s.output_data]))} />
          </>
        )}
      </div>
    </main>
  );
}

function Header({ run }: { run: Run }) {
  return (
    <header className="mt-8">
      <p className="section-kicker">Run detail</p>
      <h1 className="mt-2 break-all font-display text-3xl font-semibold sm:text-4xl">{run.file_name ?? "Untitled file"}</h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className={`run-status run-${run.status} rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium`}>{run.status}</span>
        <span className="text-sm text-muted-foreground">Created {fmtTime(run.created_at)}</span>
        {run.extraction_path === "vision" && <span className="signal-badge">Scanned image (AI read the page image)</span>}
        {run.used_cache && <span className="signal-badge" title="The AI's earlier reading of this exact file was reused">Saved AI reading</span>}
        {run.match_type === "implied" && <span className="signal-badge">PO implied, not printed</span>}
        <PdfButton id={run.id} />
      </div>
    </header>
  );
}

function PdfButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const win = window.open("", "_blank");
    try {
      const res = await fetch(`${API_BASE_URL}/runs/${encodeURIComponent(id)}/pdf`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) {
        win?.close();
        toast.error(body?.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : `Request failed (${res.status})`);
      } else if (win) win.location.href = body.url;
      else window.open(body.url, "_blank");
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not reach the API");
    } finally { setBusy(false); }
  };
  return (
    <button onClick={() => void open()} disabled={busy} className="press ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
      {busy && <LoaderCircle className="size-4 animate-spin" />}View original PDF
    </button>
  );
}

function DecisionCard({ run, stages, explanation, action }: { run: Run; stages: Stage[]; explanation: Record<string, unknown> | null; action: ReviewAction | null }) {
  if (run.status === "failed") {
    return (
      <section className="mt-8 rounded-lg border-2 border-reject bg-surface p-6">
        <h2 className="font-display text-2xl font-semibold text-reject">Run failed</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{run.error ?? "No error message recorded."}</p>
      </section>
    );
  }
  if (run.status !== "completed") {
    const current = stages.find((s) => s.status === "running") ?? stages.find((s) => s.status === "pending");
    const idx = current ? current.stage_order : stages.filter((s) => s.status !== "pending").length;
    return (
      <section className="mt-8 flex items-center gap-4 rounded-lg border border-border bg-surface p-6">
        <LoaderCircle className="size-7 animate-spin text-running" />
        <div>
          <p className="font-display text-xl font-semibold">Processing... stage {idx || 1} of 10</p>
          <p className="text-sm text-muted-foreground">{current ? STAGE_LABELS[current.stage_name] ?? current.stage_name : run.status === "queued" ? "Waiting to start" : "Working"}</p>
        </div>
      </section>
    );
  }
  const d = (run.decision ?? "none").toLowerCase();
  const check = asList(explanation?.["what_to_check"]);
  const also = asList(explanation?.["also"]);
  const color = d === "approve" ? "border-approve" : d === "review" ? "border-review" : d === "reject" ? "border-reject" : "border-neutral-status";
  return (
    <section className={`mt-8 rounded-lg border-2 ${color} bg-surface p-6 sm:p-8`}>
      <p className="section-kicker mb-3">Automated decision</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`decision-badge decision-${["approve", "review", "reject"].includes(d) ? d : "none"} !min-w-0 !rounded-md !px-4 !py-1.5 !text-base`}>{run.decision ?? "NO DECISION"}</span>
        {action && (
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            → human decision <span className={`decision-badge ${humanTone(action.action)} !min-w-0`}>{humanLabel(action.action)}</span>
          </span>
        )}
      </div>
      {explanation ? (
        <div className="mt-5 space-y-3">
          {explanation["headline"] != null && <p className="text-lg font-bold leading-relaxed">{String(explanation["headline"])}</p>}
          {explanation["context"] != null && <p className="text-sm leading-6">{String(explanation["context"])}</p>}
          {check.length > 0 && (
            <div className="pt-2">
              <h3 className="text-sm font-semibold">What the reviewer should check</h3>
              <ul className="mt-2 space-y-1.5">{check.map((c, i) => <li key={i} className="flex gap-2 text-sm"><span className="mt-0.5 size-4 shrink-0 rounded border border-foreground/50" />{show(c)}</li>)}</ul>
            </div>
          )}
          {also.length > 0 && (
            <div className="pt-2">
              <h3 className="text-sm font-semibold">Also found</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-foreground/75">{also.map((c, i) => <li key={i}>{show(c)}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6">{run.summary ?? "No summary available."}</p>
      )}
    </section>
  );
}

function ResolvedCard({ action }: { action: ReviewAction }) {
  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-6">
      <p className="section-kicker">Human in the loop</p>
      <h2 className="section-title">Reviewer decision</h2>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">System</span>
        <span className="decision-badge decision-review !min-w-0">REVIEW</span>
        <span className="text-muted-foreground">→ Human</span>
        <span className={`decision-badge ${humanTone(action.action)} !min-w-0`}>{humanLabel(action.action)}</span>
        <span>by <strong>{action.reviewer}</strong></span>
      </div>
      <p className="mt-3 text-sm"><span className="font-medium">Reason:</span> “{action.reason}”</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {fmtTime(action.created_at)} · ledger status: {action.previous_status ?? "no ledger record"}
        {action.new_status ? ` → ${action.new_status}` : ""} · the automated decision is kept unchanged
      </p>
    </section>
  );
}

function ReviewPanel({ run, ledger, onResolved }: { run: Run; ledger: Ledger | null; onResolved: () => void }) {
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [secret, setSecret] = useState("");
  const [needSecret, setNeedSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  // Browser storage only exists in the browser (this page is also rendered on the server).
  useEffect(() => { setReviewer(sessionStorage.getItem(NAME_KEY) ?? ""); }, []);

  const ready = reviewer.trim().length > 0 && reason.trim().length >= MIN_REASON;
  const approveBlock = !ledger
    ? "No ledger record (the invoice number or total is missing), so there is nothing to pay. This run can only be rejected."
    : ledger.status !== "review"
      ? `The ledger invoice is already ${ledger.status}.`
      : !ledger.vendor_id
        ? "No known vendor is attached: an unknown payee is never paid. Onboard the vendor first, or reject."
        : !ledger.po_id
          ? "No purchase order is attached. Assign the PO first, or reject."
          : null;

  const openConfirm = (a: "approve" | "reject") => {
    const stored = sessionStorage.getItem(SECRET_KEY) ?? "";
    setSecret(stored);
    setNeedSecret(!stored);
    setPending(a);
  };

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/runs/${encodeURIComponent(run.id)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Reviewer-Secret": secret },
        body: JSON.stringify({ action: pending, reviewer: reviewer.trim(), reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { detail?: unknown; message?: string } | null;
      if (!res.ok) {
        const d = body?.detail;
        const text = d ? (typeof d === "string" ? d : JSON.stringify(d)) : `Request failed (${res.status})`;
        if (res.status === 403) {
          sessionStorage.removeItem(SECRET_KEY);
          setSecret("");
          setNeedSecret(true);
          toast.error("Wrong reviewer secret. Enter it again.");
          return; // keep the dialog open so the reviewer can retry
        }
        toast.error(text);
        setPending(null);
        if (res.status === 409) onResolved(); // the state changed elsewhere: show the latest
        return;
      }
      sessionStorage.setItem(SECRET_KEY, secret);
      sessionStorage.setItem(NAME_KEY, reviewer.trim());
      toast.success(body?.message ?? "Decision recorded");
      setPending(null);
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach the API");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1.5 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <section className="mt-6 rounded-lg border-2 border-review bg-surface p-6">
      <p className="section-kicker">Human in the loop</p>
      <h2 className="section-title">Reviewer decision</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The automated decision stays REVIEW. Your decision and reason are recorded in the audit trail, and an approval updates the PO balance.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div>
          <label className="text-sm font-medium" htmlFor="reviewer-name">Your name</label>
          <input id="reviewer-name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} autoComplete="name" className={`${inputClass} h-10`} />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="review-reason">Reason (required)</label>
          <textarea id="review-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Procurement confirmed the PO was increased" className={`${inputClass} py-2`} />
          {reason.trim().length > 0 && reason.trim().length < MIN_REASON && (
            <p className="mt-1 text-xs text-muted-foreground">At least {MIN_REASON} characters.</p>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={!ready || !!approveBlock || busy} onClick={() => openConfirm("approve")}>Approve for payment</Button>
        <Button variant="destructive" disabled={!ready || busy} onClick={() => openConfirm("reject")}>Reject</Button>
      </div>
      {approveBlock && <p className="mt-3 text-sm text-muted-foreground">Approve is not available: {approveBlock}</p>}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending === "approve" ? "Approve this invoice for payment?" : "Reject this invoice?"}</DialogTitle>
            <DialogDescription>This will be recorded in the audit trail. The automated decision stays REVIEW.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (secret) void submit(); }}>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <span className="font-semibold">{pending === "approve" ? "APPROVE" : "REJECT"}</span> by <strong>{reviewer.trim()}</strong>: “{reason.trim()}”
            </div>
            {needSecret && (
              <div className="mt-4">
                <label className="text-sm font-medium" htmlFor="reviewer-secret">Reviewer secret</label>
                <input id="reviewer-secret" type="password" autoComplete="off" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} className={`${inputClass} h-10`} />
              </div>
            )}
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
              <Button type="submit" variant={pending === "reject" ? "destructive" : "default"} disabled={busy || !secret}>
                {busy && <LoaderCircle className="size-4 animate-spin" />}{pending === "approve" ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StageIcon({ status }: { status: string }) {
  switch (status) {
    case "running": return <LoaderCircle className="size-5 animate-spin text-running" />;
    case "done": return <Check className="size-5 text-approve" />;
    case "warn": return <AlertTriangle className="size-5 text-review" />;
    case "failed": return <X className="size-5 text-reject" />;
    case "skipped": return <Minus className="size-5 text-neutral-status" />;
    default: return <Circle className="size-5 text-neutral-status" />;
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function Pipeline({ stages }: { stages: Stage[] }) {
  const now = useNow(stages.some((s) => s.status === "running"));
  return (
    <section className="mt-10">
      <p className="section-kicker">Pipeline</p>
      <h2 className="section-title">Stages</h2>
      {stages.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No stages recorded yet.</p> : (
        <ol className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          {stages.map((s) => <StageRow key={s.id} stage={s} now={now} />)}
        </ol>
      )}
    </section>
  );
}

function StageRow({ stage, now }: { stage: Stage; now: number }) {
  const [open, setOpen] = useState(false);
  let dur: string | null = null;
  if (stage.started_at && stage.finished_at) dur = `${((+new Date(stage.finished_at) - +new Date(stage.started_at)) / 1000).toFixed(1)}s`;
  else if (stage.status === "running" && stage.started_at) dur = `${Math.max(0, (now - +new Date(stage.started_at)) / 1000).toFixed(1)}s`;
  const fallback = stage.stage_name === "ai_extraction" && asObj(stage.output_data)?.["source"] === "cache_fallback";
  return (
    <li className={`border-b border-border last:border-b-0 ${stage.status === "running" ? "stage-live" : stage.status !== "pending" ? "stage-enter" : ""}`} style={stage.status !== "pending" && stage.status !== "running" ? { animationDelay: `${stage.stage_order * 35}ms` } : undefined}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted">
        <span className="mt-0.5"><StageIcon status={stage.status} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{stage.stage_order}. {STAGE_LABELS[stage.stage_name] ?? stage.stage_name}</span>
            <span className="font-mono text-xs text-muted-foreground">{stage.stage_name}</span>
          </div>
          {stage.message && <p className="mt-0.5 text-sm text-muted-foreground">{stage.message}</p>}
          {fallback && <p className="mt-2 rounded border-l-[3px] border-review bg-review/15 px-3 py-1.5 text-sm">AI was unavailable; a saved reading of this exact file was used.</p>}
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{dur ?? ""}</span>
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
      </button>
      {open && (
        <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
          {(["input_data", "output_data"] as const).map((k) => (
            <div key={k} className="overflow-hidden rounded-md bg-code text-code-foreground">
              <div className="border-b border-code-border px-3 py-1.5 font-mono text-xs text-code-muted">{k}</div>
              <pre className="max-h-96 overflow-auto p-3 font-mono text-xs leading-5">{JSON.stringify(stage[k], null, 2) ?? "null"}</pre>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function RulesTable({ rules, deciding }: { rules: Rule[]; deciding: string[] }) {
  const c = (s: string) => rules.filter((r) => r.status === s).length;
  const badge = (s: string) => (s === "PASS" ? "decision-approve" : s === "WARN" ? "decision-review" : s === "FAIL" ? "decision-reject" : "decision-none");
  return (
    <section className="mt-10">
      <p className="section-kicker">Business rules</p>
      <h2 className="section-title">Rule results</h2>
      <p className="mt-2 text-sm text-muted-foreground">{c("PASS")} pass, {c("WARN")} warn, {c("FAIL")} fail, {c("SKIP")} not applicable</p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[960px] table-fixed text-left text-sm">
          <thead className="border-b border-border bg-muted text-xs uppercase text-muted-foreground">
            <tr><th className="w-12">#</th><th className="w-[210px]">Rule</th><th className="w-[90px]">Status</th><th className="w-[200px]">Expected</th><th className="w-[200px]">Actual</th><th>Message</th></tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const isDeciding = deciding.includes(r.rule_name);
              return (
                <tr key={r.rule_order} className={`border-b border-border last:border-b-0 align-top ${r.status === "SKIP" ? "text-muted-foreground" : ""} ${isDeciding ? "border-l-4 border-l-primary" : ""}`}>
                  <td className="font-mono text-xs">{r.rule_order}</td>
                  <td>
                    <div className="font-medium">{RULE_LABELS[r.rule_name] ?? r.rule_name}{isDeciding && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 font-mono text-[0.6rem] uppercase text-primary-foreground">deciding</span>}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.rule_name}</div>
                  </td>
                  <td><span className={`decision-badge ${badge(r.status)}`}>{r.status}</span></td>
                  <td className="whitespace-pre-wrap break-words font-mono text-xs">{show(r.expected_value)}</td>
                  <td className="whitespace-pre-wrap break-words font-mono text-xs">{show(r.actual_value)}</td>
                  <td className="break-words">{r.message ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
