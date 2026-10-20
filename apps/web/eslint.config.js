import { createConfig } from '@blokum/config/eslint';

export default createConfig({ react: true, ignores: ['.next/**', 'next-env.d.ts'] });
