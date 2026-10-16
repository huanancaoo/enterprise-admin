import { describe, expect, it } from 'vitest';
import { readFilesConfig } from './files-config';

const s3 = {
  FILES_STORAGE_BACKEND: 's3',
  FILES_S3_ENDPOINT: 'https://storage.example.test',
  FILES_S3_REGION: 'test',
  FILES_S3_BUCKET: 'files',
  FILES_S3_PREFIX: '',
  FILES_S3_ACCESS_KEY_ID: 'access-key',
  FILES_S3_SECRET_ACCESS_KEY: 'private-secret',
};

describe('file storage environment schema', () => {
  it('keeps omitted and disabled storage independent from backend credentials', () => {
    expect(readFilesConfig({})).toBeUndefined();
    expect(
      readFilesConfig({ FILES_STORAGE_BACKEND: 'disabled' }),
    ).toBeUndefined();
  });

  it('requires only the selected local backend fields', () => {
    expect(
      readFilesConfig({
        FILES_STORAGE_BACKEND: 'local',
        FILES_LOCAL_ROOT: '/tmp/files',
      }),
    ).toEqual({ kind: 'local', root: '/tmp/files' });
    expect(() => readFilesConfig({ FILES_STORAGE_BACKEND: 'local' })).toThrow(
      /FILES_LOCAL_ROOT/,
    );
  });

  it('accepts an explicit empty S3 prefix but rejects an absent prefix', () => {
    expect(readFilesConfig(s3)).toEqual({
      kind: 's3',
      endpoint: s3.FILES_S3_ENDPOINT,
      region: 'test',
      bucket: 'files',
      prefix: '',
      accessKeyId: 'access-key',
      secretAccessKey: 'private-secret',
    });
    expect(() =>
      readFilesConfig({ ...s3, FILES_S3_PREFIX: undefined }),
    ).toThrow('Invalid application configuration: FILES_S3_PREFIX');
  });

  it('rejects unknown backend kinds and reports missing credentials without their values', () => {
    expect(() => readFilesConfig({ FILES_STORAGE_BACKEND: 'other' })).toThrow(
      /FILES_STORAGE_BACKEND/,
    );
    expect(() =>
      readFilesConfig({ ...s3, FILES_S3_ACCESS_KEY_ID: undefined }),
    ).toThrow('Invalid application configuration: FILES_S3_ACCESS_KEY_ID');
  });
});
