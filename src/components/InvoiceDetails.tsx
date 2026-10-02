import { useState } from "react";

type O = Record<string, unknown>;
const obj = (v: unknown): O | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as O) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isNil = (v: unknown) => v === null || v === undefined || v === "";

function money(v: unknown): string | null {
  if (isNil(v)) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
}
const text = (v: unknown): string | null => (isNil(v) ? null : typeof v === "string" ? v : String(v));

function Val({ v, mono }: { v: string | null; mono?: boolean }) {
  return v === null ? <span className="italic text-muted-foreground">not on invoice</span> : <span className={mono ? "font-mono" : ""}>{v}</span>;
}

function Tag({ tone, children }: { tone: "approve" | "review" | "reject" | "none"; children: React.ReactNode }) {
  return <span className={`decision-badge decision-${tone} !min-w-0`}>{children}</span>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-5">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <div className="mt-3 space-y-5 text-sm">{children}</div>
    </div>
  );
}

const Sub = ({ children }: { children: React.ReactNode }) => <h4 className="section-kicker !text-[0.7rem]">{children}</h4>;
const NA = () => <p className="text-muted-foreground">Not available yet</p>;

export function InvoiceDetails({ outputs }: { outputs: Record<string, unknown> }) {
  return (
    <section className="mt-10">
      <p className="section-kicker">Invoice details</p>
      <h2 className="section-title">What was read and matched</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ReadCard text={obj(outputs["text_extraction"])} ai={obj(outputs["ai_extraction"])} norm={obj(obj(outputs["normalization"])?.["normalized"])} />
        <MatchCard match={obj(outputs["matching"])} norm={obj(obj(outputs["normalization"])?.["normalized"])} />
      </div>
    </section>
  );
}

function ReadCard({ text: tx, ai, norm }: { text: O | null; ai: O | null; norm: O | null }) {
  const [showCase, setShowCase] = useState(false);
  const [showText, setShowText] = useState(false);
  const ex = obj(ai?.["extracted"]);
  const source = text(ai?.["source"]);
  const sourceLabel: Record<string, string> = { gemini: "Read live by the AI", cache: "Saved AI reading of this exact file", cache_fallback: "AI unavailable - saved reading used" };

  const currencyStd = norm && !isNil(norm["currency"]) ? `${norm["currency"]}${isNil(norm["currency_kind"]) ? "" : ` (${norm["currency_kind"]})`}` : null;
  const rows: [string, string | null, string | null][] = [
    ["Vendor", text(ex?.["vendor_name"]), text(norm?.["vendor_name"])],
    ["Invoice number", text(ex?.["invoice_number"]), text(norm?.["cleaned_invoice_number"])],
    ["Invoice date", text(ex?.["invoice_date"]), text(norm?.["invoice_date"])],
    ["PO reference", text(ex?.["po_reference"]), text(norm?.["po_number"])],
    ["Currency", text(ex?.["currency"]), currencyStd],
    ["Subtotal", money(ex?.["subtotal"]), money(norm?.["subtotal"])],
    ["Tax", money(ex?.["tax_amount"]), money(norm?.["tax_amount"])],
    ["Total", money(ex?.["total"]), money(norm?.["total"])],
  ];
  const lines = list(ex?.["line_items"]).map(obj).filter(Boolean) as O[];
  const ev = obj(ex?.["evidence"]);
  const notes = list(norm?.["notes"]).map(String);
  const isCaseOnly = (n: string) => {
    const m = n.match(/'(.*)'\s*->\s*'(.*)'/);
    return !!m && m[1].toLowerCase() === m[2].toLowerCase();
  };
  const caseOnly = notes.filter(isCaseOnly);
  const real = notes.filter((n) => !isCaseOnly(n));

  return (
    <Card title="What the AI read">
      {!ai && !norm ? <NA /> : (
        <>
          {source && <p className={source === "cache_fallback" ? "font-medium text-review" : "text-muted-foreground"}>{sourceLabel[source] ?? source}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left [&_td]:!px-2 [&_td]:!py-2 [&_th]:!px-2 [&_th]:!py-2">
              <thead className="border-b border-border text-xs text-muted-foreground"><tr><th>Field</th><th>As read by the AI</th><th>Standardized</th></tr></thead>
              <tbody>
                {rows.map(([f, a, b]) => {
                  const differs = !!ex && !!norm && a !== b;
                  return (
                    <tr key={f} className={`border-b border-border last:border-b-0 ${differs ? "bg-review/10" : ""}`}>
                      <td className="font-medium">{f}</td>
                      <td className="break-all">{ex ? <Val v={a} /> : <span className="text-muted-foreground">Not available yet</span>}</td>
                      <td className="break-all">{norm ? <Val v={b} /> : <span className="text-muted-foreground">Not available yet</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <Sub>Line items</Sub>
            {lines.length === 0 ? <p className="mt-1 text-muted-foreground">{ex ? "No line items read" : "Not available yet"}</p> : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left [&_td]:!px-2 [&_td]:!py-1.5 [&_th]:!px-2 [&_th]:!py-1.5">
                  <thead className="border-b border-border text-xs text-muted-foreground"><tr><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0">
                        <td><Val v={text(l["description"])} /></td>
                        <td className="text-right font-mono tabular-nums"><Val v={text(l["quantity"])} /></td>
                        <td className="text-right font-mono tabular-nums"><Val v={money(l["unit_price"])} /></td>
                        <td className="text-right font-mono tabular-nums"><Val v={money(l["amount"])} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <Sub>Evidence the AI quoted</Sub>
            {!ex ? <NA /> : (
              <div className="mt-2 flex flex-col gap-1.5">
                {(["invoice_number", "total", "po_reference"] as const).map((k) => {
                  const v = text(ev?.[k]);
                  return (
                    <div key={k} className="flex flex-wrap items-center gap-2">
                      <span className="w-28 text-xs text-muted-foreground">{k.replace("_", " ")}</span>
                      <span className={`signal-badge !text-xs ${v ? "!text-foreground" : ""}`}>{v ?? "none"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Sub>Standardization notes</Sub>
            {!norm ? <NA /> : notes.length === 0 ? <p className="mt-1 text-muted-foreground">No changes</p> : (
              <>
                <ul className="mt-2 space-y-1 font-mono text-xs">{real.map((n, i) => <li key={i}>{n}</li>)}</ul>
                {caseOnly.length > 0 && (
                  <>
                    <button onClick={() => setShowCase(!showCase)} className="mt-2 text-xs font-medium text-primary hover:underline">
                      {showCase ? "hide" : "show"} {caseOnly.length} case-only change{caseOnly.length === 1 ? "" : "s"}
                    </button>
                    {showCase && <ul className="mt-1 space-y-1 font-mono text-xs text-muted-foreground">{caseOnly.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                  </>
                )}
              </>
            )}
          </div>

          <div>
            <button onClick={() => setShowText(!showText)} className="text-xs font-medium text-primary hover:underline">{showText ? "Hide" : "Show"} text layer preview</button>
            {showText && (
              !tx ? <NA /> : tx["path"] === "vision" ? <p className="mt-2 text-muted-foreground">No text layer (scanned image)</p> : (
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-code p-3 font-mono text-xs leading-5 text-code-foreground">{text(tx["text_preview"]) ?? "(empty)"}</pre>
              )
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function MatchCard({ match, norm }: { match: O | null; norm: O | null }) {
  if (!match) return <Card title="Vendor and PO match"><NA /></Card>;
  const vm = obj(match["vendor_match"]);
  const pm = obj(match["po_match"]);
  const vendor = obj(vm?.["vendor"]);
  const vMethod = text(vm?.["method"]);
  const po = obj(pm?.["po"]);
  const pMethod = text(pm?.["method"]);
  const score = typeof vm?.["score"] === "number" ? (vm["score"] as number).toFixed(2) : text(vm?.["score"]);
  const candidates = list(vm?.["candidates"]).map(obj).filter(Boolean) as O[];
  const implied = list(pm?.["implied_candidates"]).map(obj).filter(Boolean) as O[];
  const ruled = list(pm?.["implied_ruled_out"]).map(obj).filter(Boolean) as O[];

  const total = Number(po?.["total_amount"]);
  const billed = Number(po?.["billed_amount"]);
  const inv = Number(norm?.["total"]);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / total) * 100))}%`;
  const barOk = Number.isFinite(total) && total > 0 && Number.isFinite(billed);

  return (
    <Card title="Vendor and PO match">
      <div>
        <Sub>Vendor</Sub>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-medium">{text(vendor?.["name"]) ?? "No vendor matched"}</span>
          {vendor && <span className="font-mono text-xs text-muted-foreground">{text(vendor["id"])}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {vMethod === "exact" && <Tag tone="approve">exact match</Tag>}
          {vMethod === "fuzzy" && <Tag tone="review">similar name, score {score}</Tag>}
          {vMethod === "none" && <Tag tone="reject">not found</Tag>}
          {vendor && !isNil(vendor["status"]) && <Tag tone={vendor["status"] === "active" ? "approve" : "reject"}>{String(vendor["status"])}</Tag>}
        </div>
        {vMethod === "none" && candidates.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">Closest names</p>
            <ul className="mt-1 space-y-0.5">{candidates.map((c, i) => <li key={i} className="flex justify-between gap-4"><span>{text(c["name"])}</span><span className="font-mono text-xs tabular-nums">{typeof c["score"] === "number" ? (c["score"] as number).toFixed(2) : text(c["score"])}</span></li>)}</ul>
          </div>
        )}
      </div>

      <div>
        <Sub>Purchase order</Sub>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono font-medium">{text(po?.["po_number"]) ?? "No PO matched"}</span>
          {pMethod === "explicit" && <Tag tone="approve">printed on invoice</Tag>}
          {pMethod === "implied" && <Tag tone="review">implied from amount</Tag>}
          {pMethod === "none" && <Tag tone="none">none</Tag>}
          {po && !isNil(po["status"]) && <span className="signal-badge">{String(po["status"])}</span>}
          {po && !isNil(po["currency"]) && <span className="signal-badge">{String(po["currency"])}</span>}
        </div>
        {pm?.["reference_not_found"] === true && (
          <p className="mt-2 font-medium text-reject">The invoice cites {text(norm?.["po_number"]) ?? "a PO"}, which is not in the PO list</p>
        )}
      </div>

      {po && (
        <div>
          <Sub>PO balance</Sub>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {([["PO total", po["total_amount"]], ["Already billed (approved invoices)", po["billed_amount"]], ["Remaining", po["remaining_amount"]], ["This invoice", norm?.["total"]]] as const).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-mono tabular-nums">{money(v) ?? "—"}</dd></div>
            ))}
          </dl>
          {barOk && (
            <div className="mt-3">
              <div className="relative h-3 overflow-visible rounded-full bg-approve/25">
                <div className="h-full rounded-l-full bg-neutral-status" style={{ width: pct(billed) }} />
                {Number.isFinite(inv) && (
                  <div className="absolute -top-1 h-5 w-0.5 bg-foreground" style={{ left: pct(billed + inv) }} title="This invoice" />
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-neutral-status" />Billed</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-approve/25" />Remaining</span>
                {Number.isFinite(inv) && <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-foreground" />Billed + this invoice</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {implied.length > 0 && (
        <div>
          <Sub>Candidate POs</Sub>
          <table className="mt-2 w-full text-left [&_td]:!px-2 [&_td]:!py-1.5 [&_th]:!px-2 [&_th]:!py-1.5">
            <thead className="border-b border-border text-xs text-muted-foreground"><tr><th>PO</th><th className="text-right">Remaining</th><th className="text-right">Difference</th><th className="text-right">Tolerance</th></tr></thead>
            <tbody>
              {implied.map((c, i) => {
                const d = Number(c["difference"]);
                return (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="font-mono">{text(c["po_number"])}</td>
                    <td className="text-right font-mono tabular-nums">{money(c["remaining"]) ?? "—"}</td>
                    <td className="text-right font-mono tabular-nums">{Number.isFinite(d) ? `${d > 0 ? "+" : ""}${money(d)}` : "—"}</td>
                    <td className="text-right font-mono tabular-nums">{money(c["tolerance"]) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ruled.length > 0 && (
        <div>
          <Sub>Ruled out</Sub>
          <ul className="mt-2 space-y-1 text-muted-foreground">{ruled.map((r, i) => <li key={i}><span className="font-mono">{text(r["po_number"])}</span> — {text(r["reason"]) ?? "no reason recorded"}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}
