# Invoice Insight

Build a FRONTEND-ONLY React app called "Invoice Decision Agent".

HARD CONSTRAINTS (very important):
- Do NOT enable Lovable Cloud. Do NOT create any database, tables, migrations, edge functions, or auth.
- The backend already exists. This app only DISPLAYS data and STARTS runs. No business logic in the frontend.
- Never use mock or sample data. If a request fails, show the error message.

CONFIG: create src/config.ts with exactly these constants:
  export const API_BASE_URL = "https://zamp-case-study.onrender.com";
  export const SUPABASE_URL = "https://darvlgdsswccycsyxwsu.supabase.co";
  export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcnZsZ2Rzc3djY3ljc3l4d3N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3ODg4MjMsImV4cCI6MjEwNjM2NDgyM30.2C__JXdblVZJTyBF7oH28Y3khxLqlSGJ56GLKv17dck";
Create a Supabase client with @supabase/supabase-js createClient(SUPABASE_URL, SUPABASE_ANON_KEY). Read-only use.

EXISTING DATA (read-only, already exists in Supabase):
- table "runs": id (uuid), file_name, status ('queued'|'running'|'completed'|'failed'), decision ('APPROVE'|'REVIEW'|'REJECT'|null), summary (text), used_cache (bool), extraction_path ('text'|'vision'|null), match_type, error (text), created_at.

PAGE "/" (Dashboard):
1. Header: "Invoice Decision Agent" and subtitle "PDF invoice in -> APPROVE / REVIEW / REJECT with reasons out".
2. API status pill: on page load call GET {API_BASE_URL}/health. Show "API waking up..." (amber) while waiting (the free server can take up to 60 seconds to wake), "API online" (green) on success, "API unreachable" (red) on failure with a Retry button.
3. "New run" card:
   - Quick-pick: GET {API_BASE_URL}/samples returns a list of {file, expected_decision, expected_reason}. Show one button per sample with the file name and a small "expected: X" label. On click: POST {API_BASE_URL}/runs/sample/{file} (no body). The response is {run_id, status, file_name}. Navigate to /runs/{run_id}.
   - Upload: a drag-and-drop zone accepting one PDF. POST {API_BASE_URL}/runs as multipart/form-data with the field name "file". Same response; navigate to /runs/{run_id}.
   - On an error response, show the "detail" field of the JSON in a toast.
4. Counts row: 4 small cards: Approved, Review, Rejected, Failed (count of runs with status 'failed'), computed from the loaded runs.
5. "Run history" table: select from "runs" ordered by created_at desc, limit 50. Columns: time (local, e.g. "10:21:04"), file name, status, decision badge, summary (truncate to 1 line, full text on hover), and small badges: "scan" if extraction_path = 'vision', "cached" if used_cache = true. Clicking a row navigates to /runs/{id}.
   - Live updates: subscribe with Supabase Realtime (postgres_changes, schema public, table runs, all events) and reload the table when anything changes.

PAGE "/runs/:id" (placeholder for now): show the run id, a "Back to dashboard" link, and the raw row from "runs" for this id as formatted JSON. We will build this page properly in the next prompt.

STYLE:

- Use the attached screenshot of zamp.ai as the visual reference for the overall look: colour palette, typography, spacing, and the general feel (clean, modern, enterprise). Match its style; do not copy its content.

- Do NOT use the Zamp logo or the name "Zamp" in the app title. The app is called "Invoice Decision Agent". Add a small footer: "Built for the Zamp AI Solutions Associate case study".

- Brand colours are for the header, buttons, links and accents ONLY.

- Status colours must stay fixed and clearly distinguishable regardless of the theme: APPROVE = green, REVIEW = amber, REJECT = red, failed / none = grey.

- Readability first: high contrast text, clear tables, no decoration that makes statuses harder to scan.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://invoiceapproval.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4bd7ed25-28bb-4445-9809-56a24c4cd9e9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
