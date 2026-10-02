import busboy from 'busboy';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import {
  maxOrganizationUploadBytes,
  OverwriteFileFieldsSchema,
  UploadFileFieldsSchema,
  type OverwriteFileFields,
  type UploadFileFields,
} from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import { StorageError } from './storage/storage';

export type FileUploadStream<T> = {
  fields: T;
  contentType: string;
  source: AsyncIterable<Uint8Array>;
  completed: Promise<void>;
  signal: AbortSignal;
  dispose(): void;
};

function readFile<T>(
  request: Request,
  response: Response,
  names: readonly string[],
  parse: (fields: Record<string, string>) => T,
): Promise<FileUploadStream<T>> {
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
  let accept!: (upload: FileUploadStream<T>) => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<FileUploadStream<T>>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  let complete!: () => void;
  let rejectCompletion!: (error: unknown) => void;
  const completed = new Promise<void>((resolve, fail) => {
    complete = resolve;
    rejectCompletion = fail;
  });
  // 字段受理可能先返回，流读取期间的失败仍由 completed 和 signal 共同传播。
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
    accept({
      fields: parsed,
      contentType: info.mimeType,
      source: stream,
      completed,
      signal: controller.signal,
      dispose,
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
  return ready.catch((error: unknown) => {
    dispose();
    throw error;
  });
}

export function readFileUpload(request: Request, response: Response) {
  return readFile(
    request,
    response,
    ['operationId', 'parentId', 'name', 'contentSha256', 'declaredBytes'],
    (fields) => UploadFileFieldsSchema.parse(fields),
  );
}

export function readFileOverwrite(request: Request, response: Response) {
  return readFile(
    request,
    response,
    ['operationId', 'expectedRevision', 'contentSha256', 'declaredBytes'],
    (fields) => OverwriteFileFieldsSchema.parse(fields),
  );
}

export type OrganizationFileUpload = FileUploadStream<UploadFileFields>;
export type OrganizationFileOverwrite = FileUploadStream<OverwriteFileFields>;
