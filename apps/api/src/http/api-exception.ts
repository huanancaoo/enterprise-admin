import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@workspace/contracts';

export class ApiException extends HttpException {
  constructor(status: number, code: ApiErrorCode) {
    super({ code }, status);
  }
}
