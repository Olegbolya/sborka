/** Свои файлы для эталонных сценариев: настоящие, маленькие, без обращения к сети. */

/** Картинка в несколько цветов 32×32 — из неё извлекается палитра темы. */
export const PHOTO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAD1BMVEX07+bouSMeWqAiKDHIMh6IFIXGAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIUlEQVQ4y2NggQMmOGAEAwYIGFUw4hVAZJjBYFTBiFIAAPdfCQGLP2b1AAAAAElFTkSuQmCC',
  'base64',
);

/** Картинка 2×2 (подарок, снежинка, гирлянда — по смыслу сценария). */
export const SMALL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwDiqEAAAXQQC/0b6dI4AAAAASUVORK5CYII=', 'base64');

/** Свой GIF: один кадр 1×1. */
export const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

/** Свой звук: WAV на одну сотую секунды тишины. */
export function wav(): Buffer {
  const samples = 80;
  const data = Buffer.alloc(samples * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24);
  head.writeUInt32LE(16000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** `#RRGGBB` → `rgb(r, g, b)`, как это пишет браузер. */
export const rgbOf = (hex: string): string => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
