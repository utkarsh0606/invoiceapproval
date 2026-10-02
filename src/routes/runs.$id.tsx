import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/runs/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Run ${params.id} — Invoice Decision Agent` },
      { name: "description", content: "Raw invoice decision run details." },
      { property: "og:title", content: "Invoice run — Invoice Decision Agent" },
      { property: "og:description", content: "Raw invoice decision run details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RunPage,
});

function RunPage() {
  const { id } = Route.useParams();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.from("runs").select("*").eq("id", id).maybeSingle().then(({ data, error: requestError }) => {
      if (!active) return;
      setLoading(false);
      if (requestError) setError(requestError.message);
      else if (!data) setError("Run not found");
      else setRow(data);
    });
    return () => { active = false; };
  }, [id]);

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><ArrowLeft className="size-4" />Back to dashboard</Link>
        <p className="section-kicker mt-10">Run detail</p>
        <h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Run <span className="font-mono text-xl text-muted-foreground sm:text-2xl">{id}</span></h1>
        <div className="mt-8 overflow-hidden rounded-lg border border-border bg-code text-code-foreground">
          <div className="border-b border-code-border px-5 py-3 font-mono text-xs text-code-muted">Raw row</div>
          {loading ? <div className="flex h-48 items-center justify-center"><LoaderCircle className="size-5 animate-spin" /></div> : error ? <div className="p-5 text-sm text-reject-soft">{error}</div> : <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 sm:p-7 sm:text-sm">{JSON.stringify(row, null, 2)}</pre>}
        </div>
      </div>
    </main>
  );
}
