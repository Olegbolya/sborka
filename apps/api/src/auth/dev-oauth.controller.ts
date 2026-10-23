import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './decorators.js';

/** A-01: dev-only OAuth emulator — mirrors the minimal authorization/token/profile contract. */
@Public()
@Controller('dev/oauth')
export class DevOAuthController {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DevOAuthController запрещён в рабочей среде');
    }
  }

  /** Shows a minimal consent form so Playwright can click "Войти". */
  @Get(':provider/authorize')
  authorize(
    @Param('provider') provider: string,
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('state') state: string,
    @Query('code_challenge') _codeChallenge: string,
  ): string {
    const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const name = provider === 'vk' ? 'VK ID' : 'Яндекс ID';
    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Dev: ${safe(name)}</title></head>
<body>
<h2>Dev-эмулятор: ${safe(name)}</h2>
<form method="GET" action="${safe(redirectUri)}">
  <input type="hidden" name="state" value="${safe(state)}">
  <input type="hidden" name="code" value="dev-code-${safe(provider)}">
  <label>ID пользователя: <input name="user_id" value="42" required></label><br><br>
  <label>Имя: <input name="display_name" value="Тест Тестов" required></label><br><br>
  <button type="submit">Войти через ${safe(name)}</button>
</form>
</body>
</html>`;
  }

  /** Issues a fake access_token embedding the user info from the form. */
  @Post(':provider/token')
  token(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    // Accept both query-string and URL-encoded body.
    const body = req.body as Record<string, string> | undefined;
    const effectiveCode = code ?? body?.['code'];
    if (!effectiveCode?.startsWith('dev-code-')) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    // Token encodes provider and a default user so the profile endpoint can serve it.
    const token = Buffer.from(JSON.stringify({ provider, userId: '42', displayName: 'Тест Тестов' })).toString('base64url');
    res.json({ access_token: token, token_type: 'bearer' });
  }

  /** Returns a profile payload in the format the real provider would send. */
  @Get(':provider/me')
  me(@Param('provider') provider: string, @Req() req: Request, @Res() res: Response): void {
    const auth = req.headers['authorization'] ?? '';
    const raw = auth.replace(/^Bearer\s+/i, '');
    let payload: { userId: string; displayName: string } = { userId: '42', displayName: 'Тест Тестов' };
    try {
      payload = JSON.parse(Buffer.from(raw, 'base64url').toString()) as typeof payload;
    } catch {
      // use defaults
    }
    if (provider === 'vk') {
      const parts = payload.displayName.split(' ');
      res.json({ response: [{ id: Number(payload.userId) || 42, first_name: parts[0] ?? 'Тест', last_name: parts.slice(1).join(' ') || 'Тестов' }] });
    } else {
      res.json({ id: payload.userId, display_name: payload.displayName, login: payload.displayName });
    }
  }
}
