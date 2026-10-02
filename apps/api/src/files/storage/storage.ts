import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  FilePathError,
  normalizeFilePath,
} from '@workspace/contracts/file-path';

export type StorageOwner = {
  kind: 'organization' | 'personal';
  id: string;
};

export type StorageAddress = {
  owner: StorageOwner;
  area: 'files' | 'history' | 'trash' | 'staging';
  segments: readonly string[];
};

export type ContentFacts = { bytes: number; sha256: string };
// organizations/<UUID>/internal/staging/ + 最大 512 字节相对路径 + 目录标记。
export const maximumStorageKeyBytes = 581;
export type ByteRange = { start: number; end: number };
export type StoredRead = {
  body: Readable;
  bytes: number;
  totalBytes: number;
  range?: ByteRange;
};

export type StorageErrorCode =
  | 'STORAGE_CONFIG_INVALID'
  | 'STORAGE_NOT_FOUND'
  | 'STORAGE_CONFLICT'
  | 'STORAGE_UNSAFE_PATH'
  | 'STORAGE_DIRECTORY_NOT_EMPTY'
  | 'STORAGE_ROOT_PROTECTED'
  | 'STORAGE_LOCATION_INVALID'
  | 'STORAGE_OWNER_MISMATCH'
  | 'STORAGE_LENGTH_MISMATCH'
  | 'STORAGE_CONTENT_MISMATCH'
  | 'STORAGE_RANGE_INVALID'
  | 'STORAGE_LOCAL_FILESYSTEM_UNSUPPORTED'
  | 'STORAGE_RESPONSE_INVALID'
  | 'STORAGE_UNAVAILABLE';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'StorageError';
  }
}

// 这是物理存储接口。归属、授权、版本及操作收据由 Files 的受控入口确定。
// copy 只准备并验证目标；源清理须在数据库定位与成功审计提交后执行。
export interface FileStorage {
  ensureOwner(owner: StorageOwner): Promise<void>;
  directoryExists(address: StorageAddress): Promise<boolean>;
  createDirectory(address: StorageAddress): Promise<void>;
  write(
    address: StorageAddress,
    source: AsyncIterable<Uint8Array>,
    declaredBytes: number,
  ): Promise<ContentFacts>;
  open(address: StorageAddress, range?: ByteRange): Promise<StoredRead>;
  copy(
    source: StorageAddress,
    target: StorageAddress,
    expected: ContentFacts,
  ): Promise<void>;
  remove(address: StorageAddress): Promise<void>;
  removeDirectory(address: StorageAddress): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export type StorageConfig =
  | { kind: 'local'; root: string }
  | {
      kind: 's3';
      endpoint: string;
      region: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      secretAccessKey: string;
    };

export function storageKey(address: StorageAddress, directory = false): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(address.owner.id))
    throw new StorageError('STORAGE_LOCATION_INVALID');
  const names = normalizeFilePath(
    address.segments,
    directory ? 'folder' : 'file',
  );
  if (!directory && names.length === 0)
    throw new StorageError('STORAGE_LOCATION_INVALID');
  const owner =
    address.owner.kind === 'organization' ? 'organizations' : 'users';
  const area = address.area === 'files' ? 'files' : `internal/${address.area}`;
  return `${owner}/${address.owner.id.toLowerCase()}/${area}/${names.join('/')}${directory && names.length > 0 ? '/' : ''}`;
}

export function assertSameOwner(a: StorageAddress, b: StorageAddress): void {
  if (
    a.owner.kind !== b.owner.kind ||
    a.owner.id.toLowerCase() !== b.owner.id.toLowerCase()
  )
    throw new StorageError('STORAGE_OWNER_MISMATCH');
}

export function checkedRange(range: ByteRange, total: number): ByteRange {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.start >= total
  )
    throw new StorageError('STORAGE_RANGE_INVALID');
  return { start: range.start, end: Math.min(range.end, total - 1) };
}

export function measuredContent(
  source: AsyncIterable<Uint8Array>,
  declaredBytes: number,
) {
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0)
    throw new StorageError('STORAGE_LENGTH_MISMATCH');
  const hash = createHash('sha256');
  let bytes = 0;
  let facts: ContentFacts;
  async function* stream() {
    for await (const chunk of source) {
      bytes += chunk.byteLength;
      if (bytes > declaredBytes)
        throw new StorageError('STORAGE_LENGTH_MISMATCH');
      hash.update(chunk);
      yield chunk;
    }
    if (bytes !== declaredBytes)
      throw new StorageError('STORAGE_LENGTH_MISMATCH');
    facts = { bytes, sha256: hash.digest('hex') };
  }
  return { stream: stream(), facts: () => facts };
}

export async function verifyContent(
  read: StoredRead,
  expected: ContentFacts,
): Promise<void> {
  const measured = measuredContent(read.body, expected.bytes);
  for await (const chunk of measured.stream) void chunk;
  if (measured.facts().sha256 !== expected.sha256)
    throw new StorageError('STORAGE_CONTENT_MISMATCH');
}

export function storageFailure(error: unknown): never {
  if (error instanceof StorageError || error instanceof FilePathError)
    throw error;
  if (typeof error !== 'object' || error === null)
    throw new StorageError('STORAGE_UNAVAILABLE', error);
  const failure = error as {
    code?: string;
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (failure.code === 'ENOENT' || failure.$metadata?.httpStatusCode === 404)
    throw new StorageError('STORAGE_NOT_FOUND', error);
  if (
    failure.code === 'EEXIST' ||
    failure.$metadata?.httpStatusCode === 412 ||
    failure.$metadata?.httpStatusCode === 409
  )
    throw new StorageError('STORAGE_CONFLICT', error);
  if (failure.code === 'ENOTEMPTY')
    throw new StorageError('STORAGE_DIRECTORY_NOT_EMPTY', error);
  if (failure.code === 'ELOOP')
    throw new StorageError('STORAGE_UNSAFE_PATH', error);
  if (failure.$metadata?.httpStatusCode === 416)
    throw new StorageError('STORAGE_RANGE_INVALID', error);
  throw new StorageError('STORAGE_UNAVAILABLE', error);
}

export async function createFileStorage(
  config: StorageConfig,
): Promise<FileStorage> {
  if (config.kind === 'local') {
    const { LocalFileStorage } = await import('./local-storage.js');
    return LocalFileStorage.create(config.root);
  }
  const { S3FileStorage } = await import('./s3-storage.js');
  return S3FileStorage.create(config);
}
