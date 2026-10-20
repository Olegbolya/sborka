import { createApp } from './app.js';
import { loadApiConfig } from './config.js';

const config = loadApiConfig();
const app = await createApp(config);
await app.listen(config.port, config.host);
console.warn(`API Блокума слушает http://${config.host}:${config.port}`);
