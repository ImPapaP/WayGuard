// English / Filipino toggle (remembered on this device).
import { useEffect, useState } from 'react';
import { getLang, onLangChange, setLang } from '../lib/i18n/index.js';

export default function LangSwitch({ dark = false, className = '' }) {
  const [lang, setState] = useState(getLang());
  useEffect(() => onLangChange(setState), []);
  return (
    <div className={`lang-switch${dark ? ' lang-switch--dark' : ''} ${className}`.trim()} role="group" aria-label="Language / Wika" data-no-translate>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en" title="English">EN</button>
      <button type="button" aria-pressed={lang === 'fil'} onClick={() => setLang('fil')} lang="fil" title="Filipino">FIL</button>
    </div>
  );
}
