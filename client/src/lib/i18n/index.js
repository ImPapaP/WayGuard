// English / Filipino switch. The interface is written in English; when
// Filipino is chosen, visible text and a few attributes are swapped for the
// reviewed translations in fil.js (exact phrases only). Text people type and
// data from the server (road names, report codes) are never changed.
import { FIL, FIL_PATTERNS } from './fil.js';

const KEY = 'wg-lang';
const ATTRS = ['placeholder', 'aria-label', 'title'];
const listeners = new Set();
const origText = new WeakMap(); // Text node -> English
const origAttr = new WeakMap(); // Element -> { attr: English }
let lang = 'en';
let observer = null;

const norm = (s) => s.replace(/\s+/g, ' ').trim();

export function translate(english) {
  const key = norm(english);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(FIL, key)) return FIL[key];
  for (const [re, out] of FIL_PATTERNS) if (re.test(key)) return key.replace(re, out);
  return null;
}

function skip(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return true;
  return Boolean(el.closest('script, style, textarea, [data-no-translate], [contenteditable="true"]'));
}
// Placeholders and labels of inputs are fine to translate (never their values).
function skipAttrs(el) {
  return Boolean(el.closest('[data-no-translate]'));
}

function doText(node) {
  if (skip(node)) return;
  const current = node.nodeValue;
  const known = origText.get(node);
  // React changed the text since we translated it: start again from it.
  const english = known && (current === known.fil) ? known.en : current;
  if (lang === 'fil') {
    const t = translate(english);
    if (t) {
      const lead = english.match(/^\s*/)[0];
      const trail = english.match(/\s*$/)[0];
      const fil = lead + t + trail;
      origText.set(node, { en: english, fil });
      if (current !== fil) node.nodeValue = fil;
    } else if (known && current === known.fil) {
      node.nodeValue = known.en;
    }
  } else if (known && current === known.fil) {
    node.nodeValue = known.en;
    origText.delete(node);
  }
}

function doAttrs(el) {
  if (skipAttrs(el)) return;
  let saved = origAttr.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const current = el.getAttribute(a);
    const rec = saved?.[a];
    const english = rec && current === rec.fil ? rec.en : current;
    if (lang === 'fil') {
      const t = translate(english);
      if (t) {
        saved = saved || {};
        saved[a] = { en: english, fil: t };
        origAttr.set(el, saved);
        if (current !== t) el.setAttribute(a, t);
      }
    } else if (rec && current === rec.fil) {
      el.setAttribute(a, rec.en);
    }
  }
}

function walk(root) {
  if (root.nodeType === 3) {
    doText(root);
    return;
  }
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = tw.nextNode();
  while (n) {
    if (n.nodeType === 3) doText(n);
    else doAttrs(n);
    n = tw.nextNode();
  }
}

function start() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttrs(r.target);
      else r.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

export function getLang() {
  return lang;
}

export function setLang(next) {
  lang = next === 'fil' ? 'fil' : 'en';
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* remembered for this visit only */
  }
  document.documentElement.lang = lang === 'fil' ? 'fil' : 'en';
  start();
  walk(document.body);
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initLang() {
  let saved = 'en';
  try {
    saved = localStorage.getItem(KEY) || 'en';
  } catch {
    /* default English */
  }
  if (saved === 'fil') setLang('fil');
}
