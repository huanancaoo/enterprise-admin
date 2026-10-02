import { HttpException } from '@nestjs/common';
import {
  FileErrorDetailsSchema,
  type ApiErrorCode,
  type FileErrorDetails,
} from '@workspace/contracts';

export class ApiException extends HttpException {
  readonly details?: FileErrorDetails;

  constructor(status: number, code: ApiErrorCode, details?: FileErrorDetails) {
    super({ code }, status);
    this.details =
      details === undefined
        ? undefined
        : Object.freeze(FileErrorDetailsSchema.parse(details));
  }
}
