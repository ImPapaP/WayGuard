// Spoken hazard alerts for drive mode (Web Speech API, works offline on most
// phones). The on/off choice is remembered on this device.
const KEY = 'wg-voice-alerts';

export function voiceSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

export function voicePreference() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setVoicePreference(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: keep it for this visit only */
  }
}

export function speak(text, lang = 'en-PH') {
  if (!voiceSupported()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1;
    const voices = window.speechSynthesis.getVoices?.() || [];
    const match = voices.find((v) => v.lang === lang) || voices.find((v) => v.lang?.startsWith(lang.slice(0, 2)));
    if (match) u.voice = match;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

// Distances (m) at which an approaching pothole is announced.
export const ANNOUNCE_AT = [400, 200, 80];

export function alertText({ distance, severity, road }, lang = 'en') {
  const m = distance < 100 ? Math.max(10, Math.round(distance / 10) * 10) : Math.round(distance / 50) * 50;
  if (lang === 'fil') {
    const sev = { high: 'malalim', medium: 'katamtaman', low: 'maliit' }[severity] || '';
    return `Mag-ingat. May ${sev} na lubak, ${m} metro sa unahan${road ? `, sa ${road}` : ''}.`;
  }
  return `Caution. ${severity === 'high' ? 'Severe pothole' : severity === 'low' ? 'Small pothole' : 'Pothole'} in ${m} metres${road ? ` on ${road}` : ''}.`;
}
