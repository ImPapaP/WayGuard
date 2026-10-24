// Scroll-reveal: elements marked `data-reveal` fade and rise into view the
// first time they scroll into the window. Set `--i` on an element to stagger
// a group. Skipped entirely when the person prefers reduced motion.
export function initReveal() {
  const root = document.documentElement;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    root.classList.add('reveal-off');
    return;
  }
  root.classList.add('reveal-on');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
  );
  const watch = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches('[data-reveal]:not(.is-in)')) io.observe(node);
    node.querySelectorAll?.('[data-reveal]:not(.is-in)').forEach((el) => io.observe(el));
  };
  watch(document.body);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(watch))).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
