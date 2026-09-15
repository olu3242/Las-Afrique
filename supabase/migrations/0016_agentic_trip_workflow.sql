-- Agentic trip workflow: persisted state, evidence, exceptions, approvals and governed executions.
create table if not exists public.trip_workflows (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade, state text not null default 'DREAMING', version integer not null default 1,
  outcome_contract jsonb not null default '{}'::jsonb, context jsonb not null default '{}'::jsonb, correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,trip_id)
);
create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, workflow_id uuid not null references public.trip_workflows(id) on delete cascade,
  from_state text, to_state text not null, actor text not null, reason text not null, evidence jsonb not null default '[]'::jsonb, correlation_id uuid not null, created_at timestamptz not null default now()
);
create table if not exists public.workflow_evidence (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, workflow_id uuid not null references public.trip_workflows(id) on delete cascade,
  step_id text, type text not null, source text not null, source_reference text, observed_at timestamptz not null default now(), valid_until timestamptz, payload_hash text, metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.workflow_exceptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, workflow_id uuid not null references public.trip_workflows(id) on delete cascade,
  category text not null, severity text not null, cause text not null, recommended_action text not null, retryable boolean not null default false, status text not null default 'OPEN', created_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.workflow_approvals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, workflow_id uuid not null references public.trip_workflows(id) on delete cascade,
  action text not null, amount numeric, currency text, provider text, terms_fingerprint text not null, status text not null default 'PENDING', expires_at timestamptz not null,
  requested_at timestamptz not null default now(), decided_at timestamptz, consumed_at timestamptz
);
create table if not exists public.workflow_tool_executions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, workflow_id uuid not null references public.trip_workflows(id) on delete cascade,
  tool_name text not null, tool_version text not null, risk_level text not null, idempotency_key text not null, status text not null, input_hash text not null, output jsonb, error_code text,
  created_at timestamptz not null default now(), completed_at timestamptz, unique(workflow_id,idempotency_key)
);
create index if not exists idx_workflow_events_workflow on public.workflow_events(workflow_id,created_at);
create index if not exists idx_workflow_exceptions_open on public.workflow_exceptions(workflow_id,status);
create index if not exists idx_workflow_approvals_pending on public.workflow_approvals(workflow_id,status);

alter table public.trip_workflows enable row level security; alter table public.trip_workflows force row level security;
alter table public.workflow_events enable row level security; alter table public.workflow_events force row level security;
alter table public.workflow_evidence enable row level security; alter table public.workflow_evidence force row level security;
alter table public.workflow_exceptions enable row level security; alter table public.workflow_exceptions force row level security;
alter table public.workflow_approvals enable row level security; alter table public.workflow_approvals force row level security;
alter table public.workflow_tool_executions enable row level security; alter table public.workflow_tool_executions force row level security;

do $$ declare t text; begin foreach t in array array['trip_workflows','workflow_events','workflow_evidence','workflow_exceptions','workflow_approvals','workflow_tool_executions'] loop
  execute format('revoke all on public.%I from anon',t); execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())',t||'_select',t);
  execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())',t||'_insert',t);
  execute format('create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',t||'_update',t);
  execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())',t||'_delete',t);
end loop; end $$;
