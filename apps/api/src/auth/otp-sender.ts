export interface OtpSender {
  sendCode(phoneE164: string, code: string): Promise<void>;
}

/** Development OTP sender — logs code to stdout. Throws at construction in production (TS-30). */
export class DevOtpSender implements OtpSender {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DevOtpSender запрещён в рабочей среде (NODE_ENV=production)');
    }
  }

  sendCode(phoneE164: string, code: string): Promise<void> {
    process.stdout.write(`[DevOtp] ${phoneE164} → ${code}\n`);
    return Promise.resolve();
  }
}
