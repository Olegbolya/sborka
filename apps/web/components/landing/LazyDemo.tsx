'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

const DemoPlayer = dynamic(() => import('./DemoPlayer').then((m) => m.DemoPlayer), { ssr: false });

/**
 * The player's code is fetched a moment after the place for the demo comes near the screen (at once on a tap), so the first screen of the
 * site stays light (LCP) and a visitor who does not scroll never loads the engine.
 */
export function LazyDemo({ demoId, label = 'Поиграть' }: { demoId: string; label?: string }) {
  const [on, setOn] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || on || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        // Not at once: the engine comes after the first screen is settled, so it does not compete with it (LCP, blocking time).
        if (entries.some((e) => e.isIntersecting)) timer = setTimeout(() => setOn(true), 2500);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [on]);
  return (
    <div ref={box} className="lp-slot">
      {on ? (
        <DemoPlayer demoId={demoId} />
      ) : (
        <button type="button" className="lp-play" onClick={() => setOn(true)}>
          {label}
        </button>
      )}
    </div>
  );
}
