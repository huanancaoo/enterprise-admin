import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  maxFolderNameBytes,
  normalizeFileName,
} from '@workspace/contracts/file-path';
import { Readable, addAbortSignal } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  assertSameOwner,
  checkedRange,
  measuredContent,
  maximumStorageKeyBytes,
  storageFailure,
  storageKey,
  StorageError,
  verifyContent,
  type ByteRange,
  type ContentFacts,
  type FileStorage,
  type StorageAddress,
  type StorageConfig,
  type StorageOwner,
  type StoredRead,
} from './storage';

type S3Config = Extract<StorageConfig, { kind: 's3' }>;

export class S3FileStorage implements FileStorage {
  private constructor(
    private readonly client: S3Client,
    private readonly config: S3Config,
  ) {}

  static async create(config: S3Config): Promise<S3FileStorage> {
    try {
      const endpoint = new URL(config.endpoint);
      const prefix = config.prefix
        ? config.prefix.split('/').map(normalizeFileName).join('/')
        : '';
      // S3 key 上限为 1024 字节；为最长内部归属前缀、512 字节路径及目录标记保留空间。
      if (
        !['https:', 'http:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        !config.region ||
        !config.bucket ||
        !config.accessKeyId ||
        !config.secretAccessKey ||
        prefix !== config.prefix ||
        Buffer.byteLength(prefix) > 1024 - maximumStorageKeyBytes - 1
      )
        throw new StorageError('STORAGE_CONFIG_INVALID');
    } catch (error) {
      throw new StorageError('STORAGE_CONFIG_INVALID', error);
    }
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // 写操作的未知结果由持久化操作事实处理，SDK 不代替业务自动重试。
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return new S3FileStorage(client, config);
    } catch (error) {
      client.destroy();
      throw new StorageError('STORAGE_CONFIG_INVALID', error);
    }
  }

  private key(address: StorageAddress, directory = false): string {
    const key = storageKey(address, directory);
    return this.config.prefix ? `${this.config.prefix}/${key}` : key;
  }

  private async requireParent(
    address: StorageAddress,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    await this.client.send(
      new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(
          { ...address, segments: address.segments.slice(0, -1) },
          true,
        ),
      }),
      { abortSignal: signal },
    );
  }

  private async requireAbsent(
    address: StorageAddress,
    directory: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    // 超出目录名称预算的合法文件名不可能与目录同名；不请求非法目录标记。
    if (
      directory &&
      Buffer.byteLength(normalizeFileName(address.segments.at(-1)!)) >
        maxFolderNameBytes
    )
      return;
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(address, directory),
        }),
        { abortSignal: signal },
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return;
      throw error;
    }
    throw new StorageError('STORAGE_CONFLICT');
  }

  async createDirectory(
    address: StorageAddress,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      signal?.throwIfAborted();
      const key = this.key(address, true);
      if (address.segments.length > 0) {
        await this.requireParent(address, signal);
        await this.requireAbsent(address, false, signal);
      }
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: new Uint8Array(),
          ContentLength: 0,
          IfNoneMatch: '*',
        }),
        { abortSignal: signal },
      );
      signal?.throwIfAborted();
    } catch (error) {
      storageFailure(error);
    }
  }

  async ensureOwner(owner: StorageOwner, signal?: AbortSignal): Promise<void> {
    for (const area of ['files', 'history', 'trash', 'staging'] as const) {
      const address: StorageAddress = { owner, area, segments: [] };
      // 调用方持有归属物理锁；重启后验证确切根标记，不覆盖已有业务名称。
      if (!(await this.directoryExists(address, signal)))
        await this.createDirectory(address, signal);
    }
  }

  async directoryExists(
    address: StorageAddress,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      signal?.throwIfAborted();
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(address, true),
        }),
        { abortSignal: signal },
      );
      signal?.throwIfAborted();
      if (response.ContentLength !== 0)
        throw new StorageError('STORAGE_RESPONSE_INVALID');
      return true;
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return false;
      storageFailure(error);
    }
  }

  async write(
    address: StorageAddress,
    source: AsyncIterable<Uint8Array>,
    declaredBytes: number,
    signal?: AbortSignal,
  ): Promise<ContentFacts> {
    try {
      signal?.throwIfAborted();
      const key = this.key(address);
      const request = new AbortController();
      const transferSignal = signal
        ? AbortSignal.any([signal, request.signal])
        : request.signal;
      const measured = measuredContent(source, declaredBytes, transferSignal);
      await this.requireParent(address, signal);
      // 文件与目录共享同级名称；并发命名预留由 Files 的数据库事务协调。
      await this.requireAbsent(address, true, signal);
      const body = Readable.from(measured.stream, { objectMode: false });
      const transmitted = finished(body, { cleanup: true });
      addAbortSignal(transferSignal, body);
      const stored = this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentLength: declaredBytes,
          IfNoneMatch: '*',
        }),
        { abortSignal: transferSignal },
      );
      try {
        // HTTP 成功和输入流完整结束缺一不可，声明长度不是实际接收事实。
        await Promise.all([stored, transmitted]);
        transferSignal.throwIfAborted();
        return measured.facts();
      } catch (error) {
        // 输入失败必须同时取消 HTTP 请求，否则声明长度不足会留下等待响应的请求。
        request.abort();
        body.destroy();
        const results = await Promise.allSettled([stored, transmitted]);
        const transfer = results[1];
        if (
          transfer.status === 'rejected' &&
          transfer.reason instanceof StorageError
        )
          throw transfer.reason;
        throw error;
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async open(
    address: StorageAddress,
    range?: ByteRange,
    signal?: AbortSignal,
  ): Promise<StoredRead> {
    try {
      signal?.throwIfAborted();
      if (range) checkedRange(range, Number.MAX_SAFE_INTEGER);
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(address),
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
        { abortSignal: signal },
      );
      if (!(response.Body instanceof Readable))
        throw new StorageError('STORAGE_RESPONSE_INVALID');
      try {
        if (signal) addAbortSignal(signal, response.Body);
        signal?.throwIfAborted();
        const bytes = response.ContentLength;
        if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0)
          throw new StorageError('STORAGE_RESPONSE_INVALID');
        if (!range) return { body: response.Body, bytes, totalBytes: bytes };
        const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.ContentRange ?? '',
        );
        if (!contentRange) throw new StorageError('STORAGE_RESPONSE_INVALID');
        const totalBytes = Number(contentRange[3]);
        if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0)
          throw new StorageError('STORAGE_RESPONSE_INVALID');
        const selected = checkedRange(range, totalBytes);
        if (
          Number(contentRange[1]) !== selected.start ||
          Number(contentRange[2]) !== selected.end ||
          bytes !== selected.end - selected.start + 1
        )
          throw new StorageError('STORAGE_RESPONSE_INVALID');
        return { body: response.Body, bytes, totalBytes, range: selected };
      } catch (error) {
        response.Body.destroy();
        throw error;
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async copy(
    source: StorageAddress,
    target: StorageAddress,
    expected: ContentFacts,
    signal?: AbortSignal,
  ): Promise<void> {
    assertSameOwner(source, target);
    try {
      signal?.throwIfAborted();
      const from = this.key(source);
      const to = this.key(target);
      await this.requireParent(target, signal);
      await this.requireAbsent(target, true, signal);
      const info = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: from }),
        { abortSignal: signal },
      );
      if (!info.ETag) throw new StorageError('STORAGE_RESPONSE_INVALID');
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.config.bucket,
          Key: to,
          CopySource: [this.config.bucket, ...from.split('/')]
            .map(encodeURIComponent)
            .join('/'),
          CopySourceIfMatch: info.ETag,
          IfNoneMatch: '*',
        }),
        { abortSignal: signal },
      );
      try {
        await verifyContent(
          await this.open(target, undefined, signal),
          expected,
        );
        signal?.throwIfAborted();
      } catch (error) {
        // 取消后的远端结果可能已落盘；只能交由持有新租约的确切计划清理。
        if (!signal?.aborted) await this.remove(target, signal);
        throw error;
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async remove(address: StorageAddress, signal?: AbortSignal): Promise<void> {
    try {
      signal?.throwIfAborted();
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(address),
        }),
        { abortSignal: signal },
      );
      signal?.throwIfAborted();
    } catch (error) {
      storageFailure(error);
    }
  }

  async removeDirectory(
    address: StorageAddress,
    signal?: AbortSignal,
  ): Promise<void> {
    if (address.segments.length === 0)
      throw new StorageError('STORAGE_ROOT_PROTECTED');
    try {
      signal?.throwIfAborted();
      const key = this.key(address, true);
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: key,
          MaxKeys: 2,
        }),
        { abortSignal: signal },
      );
      if (
        result.IsTruncated ||
        result.Contents?.some((object) => object.Key !== key)
      )
        throw new StorageError('STORAGE_DIRECTORY_NOT_EMPTY');
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
        { abortSignal: signal },
      );
      signal?.throwIfAborted();
    } catch (error) {
      storageFailure(error);
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.client.destroy();
    return Promise.resolve();
  }
}
