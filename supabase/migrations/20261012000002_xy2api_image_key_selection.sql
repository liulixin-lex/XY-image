-- 第 56 条: several of a user's main-site keys serve image generation at once.
-- The studio and the node canvas list the models of every usable image key
-- and each request names the key it goes through. Keys listed here were
-- switched off in 设置 › Key: their models are not offered and new image jobs
-- through them are refused. Empty (the default) = every usable key is on.
-- image_key_id stays the default key (the design assistant, a request
-- without a key, the balance read).
alter table public.xy2api_preferences
  add column if not exists disabled_image_key_ids bigint[] not null default '{}'::bigint[];
