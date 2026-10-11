-- New design-assistant conversations were titled 'New Chat' (the column
-- default; the web creates sessions without a title and renames them after
-- the first message), so a fresh canvas showed English in the session picker.
-- Found on the pre-launch site 2026-10-11.
ALTER TABLE public.chat_sessions ALTER COLUMN title SET DEFAULT '新对话';
UPDATE public.chat_sessions SET title = '新对话' WHERE title = 'New Chat';
