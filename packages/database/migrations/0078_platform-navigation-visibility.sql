-- 导航投影也是 iframe 直达页的授权来源；hidden 只控制展示，不能让已授权节点消失。
-- 前端按 hidden 隐藏入口；启停、页面动作权限和部署 iframe 白名单仍由服务端过滤。
CREATE OR REPLACE FUNCTION public.platform_system_navigation_children(p_parent uuid,p_permissions text[])
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog SET row_security=on AS $function$
  WITH children AS MATERIALIZED (
    SELECT m.*,public.platform_system_navigation_children(m.id,p_permissions) AS children
    FROM public.platform_menu m WHERE m.parent_id IS NOT DISTINCT FROM p_parent
      AND m.status='active' AND m.kind<>'action'
      AND (m.kind<>'page' OR public.platform_menu_route_permission(m.route_key)=ANY(p_permissions))
      AND (m.kind<>'iframe' OR EXISTS(SELECT 1 FROM public.platform_iframe_origin_allowlist
        WHERE origin=lower(substring(m.url FROM '^(https?://[^/?#]+)'))))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'routeKey',route_key,
    'url',url,'icon',icon,'hidden',hidden,'children',children) ORDER BY sort,id)
    FILTER(WHERE kind<>'directory' OR jsonb_array_length(children)>0),'[]'::jsonb) FROM children;
$function$;
