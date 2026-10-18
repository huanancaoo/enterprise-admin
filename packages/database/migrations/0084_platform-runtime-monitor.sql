CREATE OR REPLACE FUNCTION public.platform_permission_catalog() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$ SELECT ARRAY['platform.authorization:manage','platform.organization:read','platform.organization:update','platform.organization:export','platform.user:read','platform.user:create','platform.user:update','platform.user:suspend','platform.user:resetPassword','platform.user:readSensitive','platform.user:unlock','platform.user:export','platform.audit:read','platform.audit:export','platform.settings:read','platform.settings:update','platform.login:read','platform.login:export','platform.session:read','platform.session:revoke','platform.session:export','platform.employee:read','platform.employee:create','platform.employee:update','platform.employee:delete','platform.employee:export','platform.role:read','platform.role:create','platform.role:update','platform.role:delete','platform.role:export','platform.menu:read','platform.menu:create','platform.menu:update','platform.menu:delete','platform.menu:export','platform.department:read','platform.department:create','platform.department:update','platform.department:delete','platform.department:export','platform.post:read','platform.post:create','platform.post:update','platform.post:delete','platform.post:export','platform.dictionary:read','platform.dictionary:create','platform.dictionary:update','platform.dictionary:delete','platform.dictionary:export','platform.dictionary:refresh','platform.parameter:read','platform.parameter:create','platform.parameter:update','platform.parameter:delete','platform.parameter:export','platform.parameter:refresh','platform.announcement:read','platform.announcement:create','platform.announcement:update','platform.announcement:delete','platform.announcement:publish','platform.announcement:readers','platform.task:read','platform.task:download','platform.monitor:read']::text[]; $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_menu_registry()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
  SELECT jsonb_build_object('pages',(SELECT jsonb_agg(jsonb_build_object('key',key,'path','/platform/'||key) ORDER BY ordinal)
    FROM unnest(ARRAY['organizations', 'users', 'employees', 'roles', 'menus', 'departments', 'posts', 'dictionaries', 'parameters', 'announcements', 'audit-events', 'login-events', 'sessions', 'settings', 'tasks','monitor']::text[]) WITH ORDINALITY AS pages(key,ordinal)),
    'actions',(SELECT jsonb_agg(jsonb_build_object('key',key) ORDER BY key) FROM unnest(public.platform_menu_actions()) AS actions(key)));
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_menu_route_permission(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $function$
  SELECT CASE p_key
    WHEN 'organizations' THEN 'platform.organization:read' WHEN 'users' THEN 'platform.user:read'
    WHEN 'employees' THEN 'platform.employee:read' WHEN 'roles' THEN 'platform.role:read'
    WHEN 'menus' THEN 'platform.menu:read' WHEN 'departments' THEN 'platform.department:read'
    WHEN 'posts' THEN 'platform.post:read' WHEN 'dictionaries' THEN 'platform.dictionary:read'
    WHEN 'parameters' THEN 'platform.parameter:read' WHEN 'announcements' THEN 'platform.announcement:read'
    WHEN 'audit-events' THEN 'platform.audit:read' WHEN 'login-events' THEN 'platform.login:read'
    WHEN 'sessions' THEN 'platform.session:read' WHEN 'settings' THEN 'platform.settings:read'
    WHEN 'tasks' THEN 'platform.task:read' WHEN 'monitor' THEN 'platform.monitor:read' END;
$function$;
--> statement-breakpoint
INSERT INTO public.platform_menu(id,key,name,sort,parent_id,kind,route_key,icon)
VALUES('819f87dd-6ca3-4493-8a08-986d6a45fd73','sys-monitor','运行监控',30,'297ac970-abb4-50e8-aed1-d432d9e1302c','page','monitor','Monitor');
