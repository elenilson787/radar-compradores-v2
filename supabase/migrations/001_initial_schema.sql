-- Radar de Compradores V2 — schema inicial
create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text not null default 'Brasil',
  products text[] not null default '{}',
  intent_phrases text[] not null default '{}',
  negative_keywords text[] not null default '{}',
  sources text[] not null default '{}',
  minimum_score integer not null default 55 check (minimum_score between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.search_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  query_count integer not null default 0,
  results_found integer not null default 0,
  results_saved integer not null default 0,
  status text not null default 'running',
  error text
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  search_run_id uuid references public.search_runs(id) on delete set null,
  source text not null,
  profile_name text,
  profile_url text,
  publication_url text,
  publication_text text not null,
  published_at timestamptz,
  score integer not null check (score between 0 and 100),
  intent text,
  product text,
  budget numeric,
  urgency text,
  relevance integer not null default 0,
  recency_weight integer not null default 100,
  status text not null default 'Novo',
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique(user_id, fingerprint)
);

create table if not exists public.lead_signals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  signal text not null,
  weight numeric,
  reason text
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;
alter table public.search_runs enable row level security;
alter table public.leads enable row level security;
alter table public.lead_signals enable row level security;
alter table public.notes enable row level security;

create policy "campaigns_owner" on public.campaigns for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "runs_owner" on public.search_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "leads_owner" on public.leads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "lead_signals_owner" on public.lead_signals
  for all
  using (exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid()));
create policy "notes_owner" on public.notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
