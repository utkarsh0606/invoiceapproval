import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, Circle, LoaderCircle, Minus, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

const STAGE_LABELS: Record<string, string> = {
  intake: "Receive file", text_extraction: "Read text layer", ai_extraction: "AI reads the invoice", normalization: "Standardize values",
  validation: "Validate the document", matching: "Match vendor and PO", rules: "Apply business rules", decision: "Decide",
  explanation: "Explain the decision", persist: "Save to ledger",
};
const RULE_LABELS: Record<string, string> = {
  required_fields: "Required fields present", math_consistency: "Amounts add up", evidence_check: "Values found in PDF text",
  vendor_known: "Vendor on vendor list", vendor_active: "Vendor is active", po_found: "Purchase order found",
  po_belongs_to_vendor: "PO belongs to this vendor", po_open: "PO is open", currency_match: "Currency matches PO",
  po_balance_check: "Fits PO remaining balance", duplicate_check: "Not a duplicate", implied_match_flag: "PO printed (not inferred)",
};

const asObj = (v: Json): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const show = (v: Json) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));
const fmtTime = (s: string) => new Date(s).toLocaleString();

function RunPage() {
  const { id } = Route.useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
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

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchRunAndStages(), fetchRules()]);
    setRefreshing(false);
    setLoading(false);
  }, [fetchRunAndStages, fetchRules]);

  useEffect(() => {
    void refreshAll();
    const channel = supabase
      .channel(`run-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `id=eq.${id}` }, () => void fetchRunAndStages())
      .on("postgres_changes", { event: "*", schema: "public", table: "run_stages", filter: `run_id=eq.${id}` }, () => void fetchRunAndStages())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [id, refreshAll, fetchRunAndStages]);

  // Re-fetch rules when rules stage finishes or run terminates
  const rulesStatus = stages.find((s) => s.stage_name === "rules")?.status;
  const trigger = `${rulesStatus === "done" || rulesStatus === "warn" ? "rules-ok" : ""}|${run?.status === "completed" || run?.status === "failed" ? run.status : ""}`;
  const lastTrigger = useRef(trigger);
  useEffect(() => {
    if (trigger !== lastTrigger.current) { lastTrigger.current = trigger; void fetchRules(); }
  }, [trigger, fetchRules]);

  const explanation = asObj(stages.find((s) => s.stage_name === "explanation")?.output_data);
  const deciding = asList(explanation?.deciding_rules).map(String);

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><ArrowLeft className="size-4" />Back to dashboard</Link>
          <button onClick={() => void refreshAll()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
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
            <DecisionCard run={run} stages={stages} explanation={explanation} />
            <Pipeline stages={stages} />
            {rules.length > 0 && <RulesTable rules={rules} deciding={deciding} />}
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
      </div>
    </header>
  );
}

function DecisionCard({ run, stages, explanation }: { run: Run; stages: Stage[]; explanation: Record<string, unknown> | null }) {
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
  const check = asList(explanation?.what_to_check);
  const also = asList(explanation?.also);
  const color = d === "approve" ? "border-approve" : d === "review" ? "border-review" : d === "reject" ? "border-reject" : "border-neutral-status";
  return (
    <section className={`mt-8 rounded-lg border-2 ${color} bg-surface p-6 sm:p-8`}>
      <span className={`decision-badge decision-${["approve", "review", "reject"].includes(d) ? d : "none"} !min-w-0 !px-5 !py-2 !text-xl`}>{run.decision ?? "NO DECISION"}</span>
      {explanation ? (
        <div className="mt-5 space-y-3">
          {explanation.headline != null && <p className="text-lg font-bold">{String(explanation.headline)}</p>}
          {explanation.context != null && <p className="text-sm leading-6">{String(explanation.context)}</p>}
          {check.length > 0 && (
            <div className="pt-2">
              <h3 className="text-sm font-semibold">What the reviewer should check</h3>
              <ul className="mt-2 space-y-1.5">{check.map((c, i) => <li key={i} className="flex gap-2 text-sm"><span className="mt-0.5 size-4 shrink-0 rounded border border-foreground/50" />{show(c)}</li>)}</ul>
            </div>
          )}
          {also.length > 0 && (
            <div className="pt-2">
              <h3 className="text-sm font-semibold">Also found</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{also.map((c, i) => <li key={i}>{show(c)}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6">{run.summary ?? "No summary available."}</p>
      )}
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
  const fallback = stage.stage_name === "ai_extraction" && asObj(stage.output_data)?.source === "cache_fallback";
  return (
    <li className="border-b border-border last:border-b-0">
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
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted text-xs uppercase text-muted-foreground">
            <tr><th>#</th><th>Rule</th><th>Status</th><th>Expected</th><th>Actual</th><th>Message</th></tr>
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
                  <td className="break-all font-mono text-xs">{show(r.expected_value)}</td>
                  <td className="break-all font-mono text-xs">{show(r.actual_value)}</td>
                  <td>{r.message ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
