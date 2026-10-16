import { z } from 'zod';
import { parseEnvironment } from '../config/environment';
import type { StorageConfig } from './storage/storage';

const storageEnvironmentSchema = z.discriminatedUnion('FILES_STORAGE_BACKEND', [
  z.object({ FILES_STORAGE_BACKEND: z.literal('disabled').optional() }),
  z.object({
    FILES_STORAGE_BACKEND: z.literal('local'),
    FILES_LOCAL_ROOT: z.string().min(1),
  }),
  z.object({
    FILES_STORAGE_BACKEND: z.literal('s3'),
    FILES_S3_ENDPOINT: z.string().min(1),
    FILES_S3_REGION: z.string().min(1),
    FILES_S3_BUCKET: z.string().min(1),
    // 空前缀代表 bucket 根目录；未提供前缀仍是配置错误。
    FILES_S3_PREFIX: z.string(),
    FILES_S3_ACCESS_KEY_ID: z.string().min(1),
    FILES_S3_SECRET_ACCESS_KEY: z.string().min(1),
  }),
]);

export function readFilesConfig(
  env: NodeJS.ProcessEnv,
): StorageConfig | undefined {
  const value = parseEnvironment(storageEnvironmentSchema, env);
  if (value.FILES_STORAGE_BACKEND === 'local')
    return { kind: 'local', root: value.FILES_LOCAL_ROOT };
  if (value.FILES_STORAGE_BACKEND === 's3')
    return {
      kind: 's3',
      endpoint: value.FILES_S3_ENDPOINT,
      region: value.FILES_S3_REGION,
      bucket: value.FILES_S3_BUCKET,
      prefix: value.FILES_S3_PREFIX,
      accessKeyId: value.FILES_S3_ACCESS_KEY_ID,
      secretAccessKey: value.FILES_S3_SECRET_ACCESS_KEY,
    };
  return undefined;
}
