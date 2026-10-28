import { HttpException } from '@nestjs/common';

/** The API's error shape: `{ error: { code, message } }` with a Russian message. */
export const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);
