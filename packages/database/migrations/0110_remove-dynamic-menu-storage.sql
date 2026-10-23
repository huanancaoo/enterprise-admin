-- 菜单专用函数已在前一迁移移除；仅删除动态菜单及其 iframe 白名单存储。
DROP TABLE "platform_iframe_origin_allowlist";--> statement-breakpoint
DROP TABLE "platform_menu";
