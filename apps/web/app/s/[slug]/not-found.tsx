export const metadata = { title: 'Недоступно — Блокум', robots: { index: false, follow: false } };

export default function Unavailable() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }} data-testid="play-unavailable">
      <div>
        <h1 style={{ margin: '0 0 8px' }}>Недоступно</h1>
        <p style={{ margin: 0 }}>Этой сборки нет или она сейчас закрыта.</p>
      </div>
    </main>
  );
}
