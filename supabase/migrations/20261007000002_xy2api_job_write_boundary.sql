-- Billing state must not be editable through the public PostgREST API.
-- Job creation/cancellation now use the authenticated Loomic server only.
-- Retain SELECT and the existing ownership policy for realtime and polling.
revoke insert, update, delete on public.background_jobs from anon, authenticated;
