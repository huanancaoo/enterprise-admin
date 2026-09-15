\set ON_ERROR_STOP on
\getenv migrator_password APP_MIGRATOR_PASSWORD
\getenv runtime_password APP_RUNTIME_PASSWORD
\getenv platform_password PLATFORM_RUNTIME_PASSWORD

-- 仅在全新数据卷中由镜像创建的 bootstrap_admin 执行，不承担应用迁移。
CREATE ROLE app_migrator LOGIN PASSWORD :'migrator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE app_runtime LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE platform_runtime LOGIN PASSWORD :'platform_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- PUBLIC 的 TEMP/CREATE 权限也必须撤销，否则 runtime 仍可创建临时对象。
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO app_migrator', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_runtime, platform_runtime', current_database()) \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_runtime, platform_runtime;

-- 新对象默认不授权；每条 migration 随表结构显式审查并授予最小权限。
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator REVOKE USAGE ON TYPES FROM PUBLIC;
