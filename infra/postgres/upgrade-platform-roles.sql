\set ON_ERROR_STOP on
\getenv platform_runtime_password PLATFORM_RUNTIME_PASSWORD
\getenv platform_deployer_password PLATFORM_DEPLOYER_PASSWORD

-- 用现有数据库的 DBA/bootstrap 管理连接执行，必须先于 migration 0022。
SELECT format('CREATE ROLE platform_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_executor') \gexec
SELECT format('CREATE ROLE platform_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'platform_runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_runtime') \gexec
SELECT format('ALTER ROLE platform_runtime PASSWORD %L', :'platform_runtime_password') \gexec
ALTER ROLE platform_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SELECT format('CREATE ROLE platform_deployer LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'platform_deployer_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_deployer') \gexec
SELECT format('ALTER ROLE platform_deployer PASSWORD %L', :'platform_deployer_password') \gexec
ALTER ROLE platform_deployer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE platform_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT platform_executor TO app_migrator;
SELECT format('GRANT CONNECT ON DATABASE %I TO platform_runtime, platform_deployer', current_database()) \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime, platform_runtime, platform_deployer, platform_executor;
