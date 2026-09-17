-- API 每次请求读取任职；CLI 与 API 共用 app_runtime 写入。没有 HTTP 授予入口。
GRANT SELECT, INSERT ON TABLE public.platform_assignment TO app_runtime;
