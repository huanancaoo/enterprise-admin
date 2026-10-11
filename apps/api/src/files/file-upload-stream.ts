import busboy from 'busboy';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  maxOrganizationUploadBytes,
  OverwriteFileFieldsSchema,
  UploadFileFieldsSchema,
  type OverwriteFileFields,
  type UploadFileFields,
} from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import {
  StorageError,
  type ContentFacts,
  type FileStorage,
  type StorageAddress,
} from './storage/storage';

type FileContentFields = { declaredBytes: number; contentSha256: string };

type FileUploadContent<T> = {
  fields: T;
  contentType: string;
  signal: AbortSignal;
  writeTo(
    storage: Pick<FileStorage, 'write'>,
    address: StorageAddress,
    signal: AbortSignal,
  ): Promise<ContentFacts>;
  verifyReplay(signal: AbortSignal): Promise<void>;
};

function readFile<T extends FileContentFields, Result>(
  request: Request,
  response: Response,
  names: readonly string[],
  parse: (fields: Record<string, string>) => T,
  use: (upload: FileUploadContent<T>) => Promise<Result>,
): Promise<Result> {
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: request.headers,
      limits: {
        fields: names.length,
        files: 1,
        // partsLimit 在恰好达到计数时触发；额外一项由字段/文件事件明确拒绝。
        parts: names.length + 2,
        fieldSize: 1024,
        // Busboy 在达到上限时标记截断；多留一个字节才能接受恰好 100 MiB。
        fileSize: maxOrganizationUploadBytes + 1,
      },
    });
  } catch {
    return Promise.reject(new ApiException(400, 'VALIDATION_ERROR'));
  }
  const controller = new AbortController();
  const fields: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  let file: Readable | undefined;
  let finished = false;
  let accept!: (upload: FileUploadContent<T>) => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<FileUploadContent<T>>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  let complete!: () => void;
  let rejectCompletion!: (error: unknown) => void;
  const completed = new Promise<void>((resolve, fail) => {
    complete = resolve;
    rejectCompletion = fail;
  });
  // 字段受理后仍可能在业务查权或存储写入前失败，此时尚无人等待终止结果。
  void completed.catch(() => {});
  const fail = (error: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(error);
    reject(error);
    rejectCompletion(error);
    request.unpipe(parser);
    file?.destroy(error instanceof Error ? error : new Error('Upload failed'));
    parser.destroy();
    request.resume();
  };
  const invalid = () => fail(new ApiException(400, 'VALIDATION_ERROR'));
  const interrupted = () => fail(new StorageError('STORAGE_UNAVAILABLE'));
  request.once('aborted', interrupted);
  request.once('error', interrupted);
  response.once('close', interrupted);
  const dispose = () => {
    if (!finished) interrupted();
    request.removeListener('aborted', interrupted);
    request.removeListener('error', interrupted);
    response.removeListener('close', interrupted);
  };
  const consumeContent = async <Result>(
    signal: AbortSignal,
    consume: () => Promise<Result>,
  ): Promise<Result> => {
    signal.throwIfAborted();
    // 内容 EOF 后仍须等 multipart 尾部；租约取消不能卡在等待客户端结束请求。
    const onAbort = () => fail(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await consume();
      // 多余字段或第二个文件可能在内容流结束后才到达，确认完整请求后才返回事实。
      await completed;
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
  parser.on('field', (name, value, info) => {
    // 元数据必须先于内容，才能在写入前固定路径、配额和幂等请求事实。
    if (
      file ||
      !names.includes(name) ||
      Object.hasOwn(fields, name) ||
      info.nameTruncated ||
      info.valueTruncated
    ) {
      invalid();
      return;
    }
    fields[name] = value;
  });
  parser.on('file', (name, stream, info) => {
    stream.once('error', fail);
    if (
      name !== 'file' ||
      file ||
      names.some((field) => !Object.hasOwn(fields, field))
    ) {
      stream.resume();
      invalid();
      return;
    }
    file = stream;
    stream.once('limit', () => fail(new ApiException(413, 'FILE_TOO_LARGE')));
    let parsed: T;
    try {
      parsed = parse(fields);
    } catch {
      invalid();
      return;
    }
    const source: AsyncIterable<Uint8Array> = stream;
    accept({
      fields: parsed,
      contentType: info.mimeType,
      signal: controller.signal,
      writeTo: (storage, address, signal) =>
        consumeContent(signal, () =>
          storage.write(address, source, parsed.declaredBytes, signal),
        ),
      verifyReplay: async (signal) => {
        // 重放核对实际字节，不能只凭相同的摘要声明返回历史成功回执。
        const facts = await consumeContent(signal, async () => {
          const hash = createHash('sha256');
          let bytes = 0;
          for await (const chunk of source) {
            signal.throwIfAborted();
            bytes += chunk.byteLength;
            if (bytes > parsed.declaredBytes)
              throw new ApiException(409, 'FILE_CONTENT_MISMATCH');
            hash.update(chunk);
          }
          return { bytes, sha256: hash.digest('hex') };
        });
        if (
          facts.bytes !== parsed.declaredBytes ||
          facts.sha256 !== parsed.contentSha256
        )
          throw new ApiException(409, 'FILE_CONTENT_MISMATCH');
      },
    });
  });
  parser.once('error', invalid);
  parser.once('fieldsLimit', invalid);
  parser.once('filesLimit', invalid);
  parser.once('partsLimit', invalid);
  parser.once('close', () => {
    if (controller.signal.aborted) return;
    if (!file) {
      invalid();
      return;
    }
    finished = true;
    complete();
  });
  request.pipe(parser);
  // 请求取消持续影响业务发布，监听器须保留到整个操作结束，而非只到内容 EOF。
  return ready.then(use).finally(dispose);
}

export function readFileUpload<Result>(
  request: Request,
  response: Response,
  use: (upload: OrganizationFileUpload) => Promise<Result>,
) {
  return readFile(
    request,
    response,
    ['operationId', 'parentId', 'name', 'contentSha256', 'declaredBytes'],
    (fields) => UploadFileFieldsSchema.parse(fields),
    use,
  );
}

export function readFileOverwrite<Result>(
  request: Request,
  response: Response,
  use: (upload: OrganizationFileOverwrite) => Promise<Result>,
) {
  return readFile(
    request,
    response,
    ['operationId', 'expectedRevision', 'contentSha256', 'declaredBytes'],
    (fields) => OverwriteFileFieldsSchema.parse(fields),
    use,
  );
}

export type OrganizationFileUpload = FileUploadContent<UploadFileFields>;
export type OrganizationFileOverwrite = FileUploadContent<OverwriteFileFields>;
