# Swarm Public — Private credit intelligence layer

## Stack

- Next.js 14 (App Router) · TypeScript · Tailwind CSS
- shadcn/ui (table, button, input, select, badge, card)
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- lucide-react · date-fns

## Folder layout

```
app/                Next.js routes
components/         UI components (shadcn/ui under components/ui)
lib/                Utilities
  lib/supabase/     Browser + server Supabase clients
  lib/types/        Shared TypeScript types
python-pipeline/    Python ingestion/enrichment jobs (added later)
```

## Local dev

```bash
cp .env.example .env.local   # fill in Supabase URL + anon key
npm install
npm run dev
```
