-- API 统一使用 app_runtime 连接池；平台任职与 MFA 仍由固定函数检查，任职写入仍归部署身份。
GRANT EXECUTE ON FUNCTION public.read_platform_access(uuid, uuid)
  TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_platform_access_denial(uuid, text, text)
  TO app_runtime;
REVOKE EXECUTE ON FUNCTION public.read_platform_access(uuid, uuid)
  FROM platform_runtime;
REVOKE EXECUTE ON FUNCTION public.record_platform_access_denial(uuid, text, text)
  FROM platform_runtime;
