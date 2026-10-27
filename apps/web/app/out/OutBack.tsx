'use client';

export function OutBack() {
  return (
    <button type="button" className="out-back" onClick={() => (window.history.length > 1 ? window.history.back() : window.close())}>
      Вернуться
    </button>
  );
}
