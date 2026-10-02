import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";
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
  used_cache: boolean;
  extraction_path: "text" | "vision" | null;
  match_type: string | null;
  error: string | null;
  created_at: string;
};

type Sample = { file: string; expected_decision: string; expected_reason: string };
type ApiState = "waking" | "online" | "unreachable";

async function errorDetail(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

function Dashboard() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [apiState, setApiState] = useState<ApiState>("waking");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

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

  const loadSamples = useCallback(async () => {
    setSamplesError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/samples`);
      if (!response.ok) throw new Error(await errorDetail(response));
      setSamples((await response.json()) as Sample[]);
    } catch (error) {
      setSamplesError(error instanceof Error ? error.message : "Could not load samples");
    }
  }, []);

  const loadRuns = useCallback(async () => {
    const { data, error } = await supabase
      .from("runs")
      .select("id,file_name,status,decision,summary,used_cache,extraction_path,match_type,error,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      setRunsError(error.message);
      return;
    }
    setRunsError(null);
    setRuns((data ?? []) as Run[]);
  }, []);

  useEffect(() => {
    void checkHealth();
    void loadSamples();
    void loadRuns();
    const channel = supabase
      .channel("runs-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, () => void loadRuns())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [checkHealth, loadRuns, loadSamples]);

  const startSample = async (file: string) => {
    setBusy(file);
    try {
      const response = await fetch(`${API_BASE_URL}/runs/sample/${encodeURIComponent(file)}`, { method: "POST" });
      if (!response.ok) throw new Error(await errorDetail(response));
      const result = (await response.json()) as { run_id: string };
      await navigate({ to: "/runs/$id", params: { id: result.run_id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start run");
    } finally {
      setBusy(null);
    }
  };

  const uploadPdf = async (file?: File) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please choose a PDF file");
      return;
    }
    setBusy("upload");
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
      setBusy(null);
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
          <div className="flex items-center gap-2 self-start lg:self-auto">
            <span className={`status-pill api-${apiState}`}>
              <span className="status-dot" />
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
            <p className="hidden text-sm text-muted-foreground sm:block">Choose a reference invoice or upload your own</p>
          </div>
          <div className="grid overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[1.35fr_0.65fr]">
            <div className="border-b border-border p-6 lg:border-b-0 lg:border-r lg:p-8">
              <div className="mb-5 flex items-center justify-between"><h3 className="font-display text-base font-semibold">Quick pick</h3><span className="text-xs text-muted-foreground">Reference invoices</span></div>
              {samplesError ? (
                <div className="error-inline"><span>{samplesError}</span><Button size="sm" variant="outline" onClick={() => void loadSamples()}>Retry</Button></div>
              ) : samples.length === 0 ? (
                <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading samples...</div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {samples.map((sample) => (
                    <Button key={sample.file} variant="outline" className="h-auto min-h-16 justify-start px-4 py-3 text-left" disabled={busy !== null} onClick={() => void startSample(sample.file)} title={sample.expected_reason}>
                      {busy === sample.file ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4 text-primary" />}
                      <span className="min-w-0"><span className="block truncate font-medium">{sample.file}</span><span className="mt-0.5 block text-[11px] font-normal uppercase text-muted-foreground">expected: {sample.expected_decision}</span></span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 lg:p-8">
              <h3 className="mb-5 font-display text-base font-semibold">Upload invoice</h3>
              <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => void uploadPdf(event.target.files?.[0])} />
              <button
                type="button"
                className={`drop-zone ${dragging ? "drop-zone-active" : ""}`}
                disabled={busy !== null}
                onClick={() => fileInput.current?.click()}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadPdf(event.dataTransfer.files[0]); }}
              >
                {busy === "upload" ? <LoaderCircle className="size-6 animate-spin text-primary" /> : <UploadCloud className="size-6 text-primary" />}
                <span className="font-medium">Drop one PDF here</span><span className="text-xs text-muted-foreground">or click to browse</span>
              </button>
            </div>
          </div>
        </section>

        <section className="mt-10" aria-label="Run counts">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CountCard label="Approved" count={counts.APPROVE} tone="approve" />
            <CountCard label="Review" count={counts.REVIEW} tone="review" />
            <CountCard label="Rejected" count={counts.REJECT} tone="reject" />
            <CountCard label="Failed" count={counts.FAILED} tone="none" />
          </div>
        </section>

        <section className="mt-10" aria-labelledby="history-title">
          <div className="mb-5 flex items-end justify-between"><div><p className="section-kicker">Latest activity</p><h2 id="history-title" className="section-title">Run history</h2></div><span className="text-xs text-muted-foreground">Last 50 runs · live</span></div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {runsError ? <div className="error-inline m-5"><span>{runsError}</span><Button size="sm" variant="outline" onClick={() => void loadRuns()}>Retry</Button></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead><tr className="border-b border-border bg-muted/60 text-[11px] uppercase text-muted-foreground"><th>Time</th><th>File name</th><th>Status</th><th>Decision</th><th>Summary</th><th>Signals</th></tr></thead>
                  <tbody>
                    {runs.length === 0 ? <tr><td colSpan={6} className="h-28 text-center text-muted-foreground">No runs found</td></tr> : runs.map((run) => (
                      <tr key={run.id} tabIndex={0} className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-muted/45 focus-visible:bg-muted focus-visible:outline-none" onClick={() => void navigate({ to: "/runs/$id", params: { id: run.id } })} onKeyDown={(event) => { if (event.key === "Enter") void navigate({ to: "/runs/$id", params: { id: run.id } }); }}>
                        <td className="font-mono text-xs text-muted-foreground">{new Date(run.created_at).toLocaleTimeString()}</td>
                        <td><span className="block max-w-56 truncate font-medium" title={run.file_name}>{run.file_name}</span></td>
                        <td><span className={`run-status run-${run.status}`}>{run.status}</span></td>
                        <td><DecisionBadge decision={run.decision} /></td>
                        <td><span className="block max-w-[440px] truncate text-muted-foreground" title={run.summary || run.error || ""}>{run.summary || run.error || "—"}</span></td>
                        <td><div className="flex gap-1.5">{run.extraction_path === "vision" && <span className="signal-badge">scan</span>}{run.used_cache && <span className="signal-badge">cached</span>}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-[1440px] border-t border-border px-5 py-7 text-xs text-muted-foreground sm:px-8 lg:px-12">Built for the Zamp AI Solutions Associate case study</footer>
    </div>
  );
}

function CountCard({ label, count, tone }: { label: string; count: number; tone: "approve" | "review" | "reject" | "none" }) {
  return <div className={`count-card count-${tone}`}><span className="text-sm text-muted-foreground">{label}</span><strong className="font-display text-3xl font-semibold">{count}</strong></div>;
}

function DecisionBadge({ decision }: { decision: Run["decision"] }) {
  return <span className={`decision-badge decision-${decision?.toLowerCase() || "none"}`}>{decision || "NONE"}</span>;
}
