-- The official canvas-design skill draws posters by running Python
-- (Pillow/reportlab) through the agent's execute tool. Production agent runs
-- use StateBackend, which has no shell and no execute tool, and
-- createAgentBackend refuses filesystem mode. The skill could never work, yet
-- every workspace had it installed and enabled, and its trigger ("use when the
-- user asks to create a poster") matches the most common request. Found on the
-- pre-launch site 2026-10-11. workspace_skills and skill_files rows go with it
-- (ON DELETE CASCADE).
DELETE FROM public.skills WHERE slug = 'canvas-design' AND source = 'system';

-- The remaining official skill is shown to users on the 技能 page; say it in
-- Chinese. The slug (the agent's path) and SKILL.md stay as they are.
UPDATE public.skills
SET name = '结构化提示词',
    description = '生成海报、插画、照片等任何图片前使用：把需求写成结构化 JSON 提示词（主体、构图、光线、风格、文字），出图更稳定、更好控制。',
    updated_at = now()
WHERE slug = 'json-image-prompt' AND source = 'system';
