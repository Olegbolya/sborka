export interface EmailSender {
  sendVerification(to: string, verifyUrl: string): Promise<void>;
  /** A notice about a decision of the moderators or about an appeal. */
  sendNotice?(to: string, subject: string, text: string): Promise<void>;
}

/** Development email sender — logs to stdout. Throws at construction in production (A-03). */
export class DevEmailSender implements EmailSender {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DevEmailSender запрещён в рабочей среде (NODE_ENV=production)');
    }
  }

  sendVerification(to: string, verifyUrl: string): Promise<void> {
    process.stdout.write(`[DevEmail] Подтверждение email ${to} → ${verifyUrl}\n`);
    return Promise.resolve();
  }

  sendNotice(to: string, subject: string, text: string): Promise<void> {
    process.stdout.write(`[DevEmail] ${subject} → ${to}: ${text}\n`);
    return Promise.resolve();
  }
}
