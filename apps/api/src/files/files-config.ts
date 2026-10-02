import type { StorageConfig } from './storage/storage';

export function readFilesConfig(
  env: NodeJS.ProcessEnv,
): StorageConfig | undefined {
  const backend = env.FILES_STORAGE_BACKEND;
  if (backend === undefined || backend === 'disabled') return undefined;
  function required(name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  }
  if (backend === 'local')
    return { kind: 'local', root: required('FILES_LOCAL_ROOT') };
  if (backend === 's3') {
    const prefix = env.FILES_S3_PREFIX;
    if (prefix === undefined) throw new Error('FILES_S3_PREFIX is required');
    return {
      kind: 's3',
      endpoint: required('FILES_S3_ENDPOINT'),
      region: required('FILES_S3_REGION'),
      bucket: required('FILES_S3_BUCKET'),
      prefix,
      accessKeyId: required('FILES_S3_ACCESS_KEY_ID'),
      secretAccessKey: required('FILES_S3_SECRET_ACCESS_KEY'),
    };
  }
  throw new Error('FILES_STORAGE_BACKEND must be disabled, local or s3');
}
