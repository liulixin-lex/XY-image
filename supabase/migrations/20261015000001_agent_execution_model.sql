-- 第 70 条: the design assistant's 执行步骤模型 (设置 › 模型). The model calls
-- that follow a tool result use this model and level; null model = the chat
-- model, null level = 低 where the model takes it (chat-options.ts
-- defaultExecutionEffort). The model is a chat model id as /api/models
-- lists it (openai:<model> or custom:<providerId>:<model>); the runtime
-- falls back to the chat model when it is no longer usable.
alter table public.xy2api_preferences
  add column if not exists agent_exec_model text,
  add column if not exists agent_exec_effort text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.xy2api_preferences'::regclass
      and conname = 'xy2api_preferences_agent_exec_model_check') then
    alter table public.xy2api_preferences
      add constraint xy2api_preferences_agent_exec_model_check
      check (agent_exec_model is null or (length(agent_exec_model) between 3 and 300 and agent_exec_model ~ '^(openai|custom):'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.xy2api_preferences'::regclass
      and conname = 'xy2api_preferences_agent_exec_effort_check') then
    alter table public.xy2api_preferences
      add constraint xy2api_preferences_agent_exec_effort_check
      check (agent_exec_effort is null or agent_exec_effort in ('auto', 'low', 'medium', 'high', 'xhigh', 'max'));
  end if;
end $$;
