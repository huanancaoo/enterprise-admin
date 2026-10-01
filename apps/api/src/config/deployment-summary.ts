import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApplicationConfig } from './application-config';

export const PLATFORM_DEPLOYMENT_SUMMARY = Symbol('platformDeploymentSummary');
export type DeploymentSummary = {
  environment: string;
  applicationVersion: string;
  smtpConfigured: boolean;
};

export function readDeploymentSummary(
  config: ApplicationConfig,
): DeploymentSummary {
  const metadata = JSON.parse(
    readFileSync(join(__dirname, '../../package.json'), 'utf8'),
  ) as { version: string };
  // 配置状态只表示必需 SMTP 配置已通过启动校验，不表示投递成功或 SMTP 在线。
  return {
    environment: process.env.NODE_ENV ?? 'development',
    applicationVersion: metadata.version,
    smtpConfigured: Boolean(
      config.email.smtp.host &&
      config.email.smtp.port &&
      config.email.from.email,
    ),
  };
}
