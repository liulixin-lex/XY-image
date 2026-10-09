create schema storage;
create table storage.buckets(id text primary key, public boolean not null default false);
insert into storage.buckets values ('project-assets',true),('brand-kit-assets',false),('canvases',true),('user-avatars',false);
create table storage.objects(bucket_id text, name text);
alter table storage.objects enable row level security;
-- Deliberately vulnerable defaults reproduce the open canvases bucket.
create policy "canvases_insert_authenticated" on storage.objects for insert to authenticated with check (bucket_id = 'canvases');
create policy "canvases_select_public" on storage.objects for select to public using (bucket_id = 'canvases');
create schema langgraph;
create table langgraph.checkpoints(id int);
create table langgraph.store(id int);
create schema pgmq;
create table pgmq.q_image_generation_jobs(id int);
create table public.agent_runs(id uuid primary key);
alter table public.agent_runs enable row level security;
create table public.subscriptions(id uuid);
create table public.credit_balances(id uuid);
create table public.credit_transactions(id uuid);
create table public.daily_credit_claims(id uuid);
create table public.payment_events(id uuid);
-- Deliberately vulnerable defaults reproduce the retired RPC exposure.
create function public.grant_plan_credits(p_id uuid) returns int language sql security definer as $$ select 1 $$;
create function public.deduct_credits(p_id uuid) returns int language sql security definer as $$ select 1 $$;
create function public.refund_credits(p_id uuid) returns int language sql security definer as $$ select 1 $$;
create function public.claim_daily_credits(p_id uuid) returns int language sql security definer as $$ select 1 $$;
create function public.increment_job_attempt(p_id uuid) returns int language sql as $$ select 1 $$;
grant all on public.subscriptions,public.credit_balances,public.credit_transactions,public.daily_credit_claims,public.payment_events to anon,authenticated;
grant usage on schema langgraph to public;
