import { ARTBOARD_WIDTH } from '@blokum/renderer';

const styles = {
  main: {
    minHeight: '100dvh',
    display: 'grid',
    placeItems: 'center',
    padding: '32px 16px',
  },
  card: { maxWidth: 560, textAlign: 'center' as const },
  title: { fontSize: 'clamp(40px, 8vw, 72px)', lineHeight: 1, margin: '0 0 16px', letterSpacing: '-0.03em' },
  accent: { color: 'var(--accent)' },
  text: { fontSize: 18, lineHeight: 1.5, color: 'var(--muted)', margin: 0 },
};

export default function HomePage() {
  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <h1 style={styles.title}>
          Блокум<span style={styles.accent}> — скоро</span>
        </h1>
        <p style={styles.text}>
          Собирайте открытки, тесты, квизы и свои мини-игры из блоков на холсте шириной {ARTBOARD_WIDTH} единиц,
          делитесь ссылкой или QR-кодом и смотрите ответы в личном кабинете.
        </p>
      </div>
    </main>
  );
}
