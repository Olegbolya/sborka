export interface CaptchaVerifier {
  verify(token: string, ip: string): Promise<boolean>;
}

/** Development captcha verifier — always passes. Throws at construction in production (TS-30). */
export class DevCaptchaVerifier implements CaptchaVerifier {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DevCaptchaVerifier запрещён в рабочей среде (NODE_ENV=production)');
    }
  }

  verify(_token: string, _ip: string): Promise<boolean> {
    return Promise.resolve(true);
  }
}
