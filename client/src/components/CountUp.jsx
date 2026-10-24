// A number that counts up from zero when it first scrolls into view.
import { useEffect, useRef, useState } from 'react';

export default function CountUp({ value, duration = 1100, className = 'numeral' }) {
  const target = Number(value) || 0;
  const decimals = String(value).includes('.') ? String(value).split('.')[1].length : 0;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(reduce ? target : 0);
  const el = useRef(null);
  useEffect(() => {
    if (reduce || !el.current || !('IntersectionObserver' in window)) {
      setShown(target);
      return undefined;
    }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - (1 - p) ** 3;
        setShown(target * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el.current);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, duration, reduce]);
  return (
    <span ref={el} className={className}>
      {shown.toFixed(decimals)}
    </span>
  );
}
