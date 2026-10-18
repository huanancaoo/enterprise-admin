-- 图标属于菜单配置；仅补齐内置一级入口，管理员已有配置继续作为展示来源。
UPDATE public.platform_menu AS menu
SET icon = defaults.icon, updated_at = clock_timestamp()
FROM (VALUES
  ('sys-organizations', 'Building'),
  ('sys-users', 'Users'),
  ('sys-system-management', 'Settings2'),
  ('sys-system-monitoring', 'Monitor'),
  ('sys-settings', 'Settings')
) AS defaults(key, icon)
WHERE menu.key = defaults.key AND menu.parent_id IS NULL AND menu.icon IS NULL;
