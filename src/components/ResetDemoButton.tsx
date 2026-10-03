import { useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { API_BASE_URL } from "@/config";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KEY = "zampResetSecret";

export function ResetDemoButton({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"none" | "secret" | "confirm">("none");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const start = () => {
    const stored = sessionStorage.getItem(KEY) ?? "";
    setSecret(stored);
    setStep(stored ? "confirm" : "secret");
  };

  const reset = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/reset`, { method: "POST", headers: { "X-Reset-Secret": secret } });
      const body = (await res.json().catch(() => null)) as { detail?: unknown; invoices?: number; runs?: number } | null;
      if (!res.ok) {
        if (res.status === 403) sessionStorage.removeItem(KEY);
        const d = body?.detail;
        toast.error(d ? (typeof d === "string" ? d : JSON.stringify(d)) : `Reset failed (${res.status})`);
        return;
      }
      sessionStorage.setItem(KEY, secret);
      toast.success(`Reset done: ${body?.invoices ?? 0} seed invoices, ${body?.runs ?? 0} runs`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach the API");
    } finally {
      setBusy(false);
      setStep("none");
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" className="border-reject/50 text-reject hover:bg-reject/10 hover:text-reject" onClick={start}>
        <RotateCcw className="size-3.5" /> Reset demo data
      </Button>

      <Dialog open={step === "secret"} onOpenChange={(o) => !o && setStep("none")}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset secret</DialogTitle><DialogDescription>Enter the reset secret to continue.</DialogDescription></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (secret) setStep("confirm"); }}>
            <label className="text-sm font-medium" htmlFor="reset-secret">Reset secret</label>
            <input id="reset-secret" type="password" autoComplete="off" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={() => setStep("none")}>Cancel</Button>
              <Button type="submit" disabled={!secret}>Next</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={step === "confirm"} onOpenChange={(o) => !o && !busy && setStep("none")}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset demo data?</DialogTitle><DialogDescription>This deletes all runs and restores the ledger, vendors and POs to the seed data. Saved AI readings are kept. Continue?</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setStep("none")}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void reset()}>{busy && <LoaderCircle className="size-4 animate-spin" />}Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
