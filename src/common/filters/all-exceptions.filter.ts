import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

const SAFE_ERROR_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'EDNS',
  'EAUTH',
  'EENVELOPE',
  'ESOCKET',
  'ESMTP',
  'ETIMEDOUT',
]);

const SAFE_FAILURE_PHASES = new Set([
  'AUTH',
  'CONN',
  'DATA',
  'EHLO',
  'MAIL',
  'QUIT',
  'RCPT',
  'STARTTLS',
]);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'حدث خطأ غير متوقع في الخادم.';
    let error = 'Internal Server Error';

    if (isHttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? message;
        error = (b.error as string) ?? HttpStatus[statusCode];
      }
    } else {
      this.logger.error(
        JSON.stringify({
          event: 'Unhandled exception',
          errorType: this.safeErrorType(exception),
          code: this.safeAllowlistedProperty(exception, 'code', SAFE_ERROR_CODES),
          phase: this.safeAllowlistedProperty(
            exception,
            'command',
            SAFE_FAILURE_PHASES,
          ),
        }),
      );
    }

    response.status(statusCode).json({
      statusCode,
      error,
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
    });
  }

  private safeErrorType(exception: unknown): string {
    if (exception instanceof TypeError) return 'TypeError';
    if (exception instanceof RangeError) return 'RangeError';
    if (exception instanceof SyntaxError) return 'SyntaxError';
    if (exception instanceof ReferenceError) return 'ReferenceError';
    if (exception instanceof URIError) return 'URIError';
    if (exception instanceof EvalError) return 'EvalError';
    if (exception instanceof Error) return 'Error';
    return 'UnknownError';
  }

  private safeAllowlistedProperty(
    exception: unknown,
    property: 'code' | 'command',
    allowlist: Set<string>,
  ): string | undefined {
    if (typeof exception !== 'object' || exception === null) return undefined;

    const descriptor = Object.getOwnPropertyDescriptor(exception, property);
    const value = descriptor?.value;
    return typeof value === 'string' && allowlist.has(value) ? value : undefined;
  }
}