// A small SMTP client (RFC 5321) for sending plain-text notification e-mail.
// Supports implicit TLS (port 465), STARTTLS (port 587) and AUTH PLAIN.
// Credentials are never sent over an unencrypted connection, except to a
// server on localhost (useful with a local test mail catcher).
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';

function stripCrlf(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
}

export function extractAddress(value) {
  const s = stripCrlf(value);
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  const addr = m ? m[1] : s;
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(addr)) throw new Error(`Invalid e-mail address: ${addr}`);
  return addr;
}

function encodeHeader(value) {
  const s = stripCrlf(value);
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

export function buildMessage({ from, to, subject, text }) {
  const domain = extractAddress(from).split('@')[1] || 'localhost';
  const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${encodeHeader(from)}`,
    `To: ${encodeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

class SmtpConnection {
  constructor(socket, timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.waiter = null;
    socket.setEncoding('utf8');
    socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('SMTP connection timed out')));
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).replace(/\r$/, '');
        this.buffer = this.buffer.slice(idx + 1);
        this.lines.push(line);
        if (/^\d{3}( |$)/.test(line)) this.flush();
      }
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  flush() {
    if (!this.waiter) return;
    const lines = this.lines;
    this.lines = [];
    const code = Number(lines[lines.length - 1].slice(0, 3));
    const { resolve } = this.waiter;
    this.waiter = null;
    resolve({ code, lines });
  }

  fail(err) {
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(err);
    }
  }

  read() {
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      if (this.lines.length && /^\d{3}( |$)/.test(this.lines[this.lines.length - 1])) this.flush();
    });
  }

  async command(line, expected) {
    const pending = this.read();
    this.socket.write(`${line}\r\n`);
    const res = await pending;
    if (!expected.includes(res.code)) {
      const shown = line.startsWith('AUTH') ? 'AUTH' : line;
      throw new Error(`SMTP "${shown}" failed: ${res.lines.join(' | ')}`);
    }
    return res;
  }
}

export async function sendMail(options) {
  const { host, port, secure, user, pass, from, to, subject, text, timeoutMs = 20_000 } = options;
  const connect = () =>
    new Promise((resolve, reject) => {
      const socket = secure
        ? tls.connect({ host, port, servername: host }, () => resolve(socket))
        : net.connect({ host, port }, () => resolve(socket));
      socket.once('error', reject);
    });
  const socket = await connect();
  const conn = new SmtpConnection(socket, timeoutMs);
  let encrypted = secure;
  try {
    const greeting = await conn.read();
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed: ${greeting.lines.join(' | ')}`);
    const hostname = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
    let ehlo = await conn.command(`EHLO ${hostname}`, [250]);
    const hasStartTls = () => ehlo.lines.some((l) => /STARTTLS/i.test(l));
    if (!secure && hasStartTls()) {
      await conn.command('STARTTLS', [220]);
      const upgraded = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket: conn.socket, servername: host }, () => resolve(s));
        s.once('error', reject);
      });
      conn.socket.removeAllListeners('data');
      conn.attach(upgraded);
      encrypted = true;
      ehlo = await conn.command(`EHLO ${hostname}`, [250]);
    }
    if (user) {
      const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
      if (!encrypted && !isLocal) throw new Error('Refusing to send SMTP credentials without TLS.');
      const token = Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64');
      await conn.command(`AUTH PLAIN ${token}`, [235]);
    }
    await conn.command(`MAIL FROM:<${extractAddress(from)}>`, [250]);
    await conn.command(`RCPT TO:<${extractAddress(to)}>`, [250, 251]);
    await conn.command('DATA', [354]);
    // Base64 bodies never start a line with ".", so no dot-stuffing is needed.
    await conn.command(`${buildMessage({ from, to, subject, text })}\r\n.`, [250]);
    await conn.command('QUIT', [221]).catch(() => {});
  } finally {
    conn.socket.destroy();
  }
}
