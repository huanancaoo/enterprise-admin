-- 默认导航沿用已确认的“在线用户”；自行更名的菜单配置不被版本更新覆盖。
UPDATE public.platform_menu
SET name = '在线用户', updated_at = now()
WHERE id = '7e945459-1853-5412-9973-8fce4eb7baac'
  AND key = 'sys-sessions'
  AND name = '在线会话';
