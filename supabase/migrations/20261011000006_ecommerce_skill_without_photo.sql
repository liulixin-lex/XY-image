-- 电商主图 without a product photo (FINDINGS A3): the skill stopped and
-- asked for an upload. It now offers two ways on, and the user picks.
-- Installed copies read this row, so they change too. Re-runnable.
UPDATE public.skills
   SET skill_content = replace(
         skill_content,
         '- 没有商品照片时，先请用户上传。不要凭文字描述重新画一个商品：画出来的和实物不一致，不能拿去卖。',
         E'- 没有商品照片时，不要直接停下，给用户两个选择，让他选：\n  1. 上传商品照片（推荐）：商品外观、logo 和包装文字都和实物一致，可以直接拿去卖。\n  2. 先生成一张示意图：按文字描述画一个接近的商品，适合先看构图、背景和氛围。要说清楚示意图里的商品和实物不会完全一样，上架前要换成实拍商品重做。\n  用户选了 2，就照常出图，并在回复里再提醒一次这是示意图。'
       ),
       version = '1.1'
 WHERE slug = 'xy-ecommerce-product'
   AND source = 'community'
   AND skill_content LIKE '%没有商品照片时，先请用户上传%';
