/** Service galleries under /dev (P1.4–P1.9) exist in development; in production only when explicitly enabled. */
export const devPagesEnabled = (): boolean => process.env.NODE_ENV !== 'production' || process.env.BLOKUM_DEV_PAGES === '1';
