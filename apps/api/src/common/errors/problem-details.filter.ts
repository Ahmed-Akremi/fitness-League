import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException, ErrorCode } from './app-exception';

const TYPE_BASE = 'https://errors.fitnessleague.app/';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: unknown[];
  traceId?: string;
  [extra: string]: unknown;
}

const statusToCode: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  422: ErrorCode.VALIDATION_FAILED,
  429: ErrorCode.RATE_LIMITED,
};

/** Renders every error as RFC 9457 problem+json. Never leaks stack traces or internal messages. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const traceId = req.id !== undefined ? String(req.id) : undefined;

    const { body, headers } = this.toProblem(exception);
    body.traceId = traceId;
    if (body.status >= 500) {
      this.logger.error({ err: exception, traceId }, 'Unhandled error');
    }
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(body.status).type('application/problem+json').json(body);
  }

  private toProblem(exception: unknown): { body: ProblemBody; headers: Record<string, string> } {
    if (exception instanceof AppException) {
      const { detail, errors, extra, headers } = exception.options;
      return {
        body: {
          type: TYPE_BASE + exception.code.toLowerCase().replace(/_/g, '-'),
          title: exception.title,
          status: exception.status,
          code: exception.code,
          ...(detail && { detail }),
          ...(errors && { errors }),
          ...extra,
        },
        headers: headers ?? {},
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return { body: this.generic(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'Conflict'), headers: {} };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = statusToCode[status] ?? (status >= 500 ? ErrorCode.INTERNAL : ErrorCode.VALIDATION_FAILED);
      // Framework messages (e.g. malformed JSON, 404 route) are safe to expose as title only for 4xx.
      const title = status < 500 ? exception.message : 'Internal error';
      return { body: this.generic(status, code, title), headers: {} };
    }

    return { body: this.generic(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL, 'Internal error'), headers: {} };
  }

  private generic(status: number, code: ErrorCode, title: string): ProblemBody {
    return { type: TYPE_BASE + code.toLowerCase().replace(/_/g, '-'), title, status, code };
  }
}
