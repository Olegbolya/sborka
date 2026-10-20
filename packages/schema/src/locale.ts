import { z } from 'zod';

// Every validation message that can reach a user is in Russian (N-05). Importing @blokum/schema
// switches zod to the Russian locale once for the whole process.
z.config(z.locales.ru());

export { z };
