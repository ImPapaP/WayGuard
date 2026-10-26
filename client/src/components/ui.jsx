// Small building blocks shared by every screen.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LuCircleAlert,
  LuInfo,
  LuTriangleAlert,
  LuCircleCheck,
  LuX,
  LuInbox,
  LuChevronLeft,
  LuChevronRight,
  LuSend,
  LuSearch,
  LuShieldCheck,
  LuUsers,
  LuWrench,
  LuCircleX,
  LuCopy,
  LuHourglass,
  LuEye,
  LuEyeOff,
  LuCircle,
} from 'react-icons/lu';
import { STATUS, SEVERITY } from '../lib/format.js';

export function Button({ variant = 'secondary', size, block, loading, children, className = '', ...rest }) {
  const cls = ['btn', `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, optional, children, id: givenId, className = '' }) {
  const autoId = useId();
  const id = givenId || autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const child = typeof children === 'function' ? children({ id, describedBy, invalid: Boolean(error) }) : children;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field__label" htmlFor={id}>
          {label} {optional && <span className="field__optional">(optional)</span>}
        </label>
      )}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {child}
      {error && (
        <p className="field__error" id={errorId}>
          <LuCircleAlert aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

// Text input wired to a Field (label, hint and error are announced).
export function TextField({ label, hint, error, optional, multiline, className, ...input }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={className}>
      {({ id, describedBy, invalid }) =>
        multiline ? (
          <textarea id={id} className="textarea" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...input} />
        ) : (
          <input id={id} className="input" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...input} />
        )
      }
    </Field>
  );
}

// Password input with a show / hide button inside the field.
export function PasswordField({ label, hint, error, optional, className, ...input }) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="password-input">
          <input
            id={id}
            className="input"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            {...input}
            type={shown ? 'text' : 'password'}
          />
          <button
            type="button"
            className="password-input__toggle"
            aria-label={shown ? `Hide ${String(label).toLowerCase()}` : `Show ${String(label).toLowerCase()}`}
            aria-pressed={shown}
            aria-controls={id}
            onClick={() => setShown((v) => !v)}
          >
            {shown ? <LuEyeOff aria-hidden /> : <LuEye aria-hidden />}
            <span>{shown ? 'Hide' : 'Show'}</span>
          </button>
        </div>
      )}
    </Field>
  );
}

// Live checklist for a new password (the server applies the same rules).
export function PasswordRules({ value, confirm }) {
  const rules = [
    { ok: value.length >= 8, text: 'At least 8 characters' },
    { ok: /[A-Za-z]/.test(value), text: 'A letter' },
    { ok: /\d/.test(value), text: 'A number' },
  ];
  if (confirm !== undefined) rules.push({ ok: Boolean(value) && value === confirm, text: 'Both passwords match' });
  return (
    <ul className="password-rules" aria-label="Password requirements">
      {rules.map((r) => (
        <li key={r.text} className={r.ok ? 'is-ok' : ''}>
          {r.ok ? <LuCircleCheck aria-hidden /> : <LuCircle aria-hidden />}
          {r.text}
          <span className="visually-hidden">{r.ok ? ' (done)' : ' (not yet)'}</span>
        </li>
      ))}
    </ul>
  );
}

// Long lists (e.g. the 1,600+ cities and municipalities) become a
// type-to-search box; short ones stay a normal <select>.
const SEARCH_THRESHOLD = 25;

export function SelectField({ label, hint, error, optional, options, placeholder, className, searchable, ...select }) {
  const real = options.filter((o) => o.value !== '' && o.value != null);
  if (searchable ?? real.length > SEARCH_THRESHOLD) {
    const emptyLabel = placeholder ?? options.find((o) => o.value === '')?.label;
    return (
      <Field label={label} hint={hint} error={error} optional={optional} className={className}>
        {({ id, describedBy, invalid }) => (
          <SearchSelect
            id={id}
            describedBy={describedBy}
            invalid={invalid}
            options={real}
            value={select.value}
            onChange={select.onChange}
            disabled={select.disabled}
            placeholder={emptyLabel ? `Search — ${String(emptyLabel).replace(/…$/, '')}` : 'Type to search'}
            label={label}
          />
        )}
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="select" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...select}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

// Accessible combobox. onChange receives { target: { value } } like a <select>.
export function SearchSelect({ id, describedBy, invalid, options, value, onChange, placeholder, disabled, label }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef(null);
  const selected = options.find((o) => String(o.value) === String(value ?? ''));
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = (words.length
    ? options.filter((o) => words.every((w) => String(o.label).toLowerCase().includes(w)))
    : options
  ).slice(0, 40);
  const fire = (v) => onChange?.({ target: { value: v } });
  const choose = (o) => {
    fire(String(o.value));
    setQ('');
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  if (selected && !open) {
    return (
      <div className="search-select__chosen">
        <span id={id} tabIndex={-1} aria-describedby={describedBy}>{selected.label}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled}
          aria-label={`Change ${String(label || 'selection').toLowerCase()}`}
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        >
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="search-select">
      <div className="search-input">
        <LuSearch aria-hidden />
        <input
          ref={inputRef}
          id={id}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
      </div>
      {open && (
        <ul className="search-select__list" id={listId} role="listbox" aria-label={label ? `${label} choices` : 'Choices'}>
          {results.length ? results.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          )) : <li className="search-select__empty" role="presentation">No match</li>}
          {!words.length && options.length > results.length && (
            <li className="search-select__empty" role="presentation">Type to search all {options.length.toLocaleString()} choices</li>
          )}
        </ul>
      )}
    </div>
  );
}

const STATUS_ICONS = {
  submitted: LuSend,
  under_review: LuSearch,
  verified: LuShieldCheck,
  assigned: LuUsers,
  in_progress: LuWrench,
  resolved: LuCircleCheck,
  rejected: LuCircleX,
  duplicate: LuCopy,
};
export function statusIcon(status) {
  return STATUS_ICONS[status] || LuInfo;
}

export function StatusBadge({ status, awaiting }) {
  if (awaiting && status === 'in_progress') {
    return (
      <span className="badge badge--awaiting" title="Repair finished; waiting for LGU verification">
        <LuHourglass aria-hidden /> Awaiting check
      </span>
    );
  }
  const Icon = statusIcon(status);
  return (
    <span className={`badge badge--${status}`}>
      <Icon aria-hidden /> {STATUS[status]?.label || status}
    </span>
  );
}

export function SeverityBadge({ severity, showLabel = true }) {
  return (
    <span className={`sev sev--${severity}`} title={`${SEVERITY[severity]?.label} severity`}>
      <span className="sev__bars" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {showLabel ? SEVERITY[severity]?.label : <span className="visually-hidden">{SEVERITY[severity]?.label}</span>}
    </span>
  );
}

// Priority score 0–100 with a word, so it never relies on colour alone.
export function priorityBand(score) {
  if (!score) return { key: 'none', label: 'Closed' };
  if (score >= 70) return { key: 'urgent', label: 'Urgent' };
  if (score >= 45) return { key: 'high', label: 'High' };
  if (score >= 25) return { key: 'normal', label: 'Normal' };
  return { key: 'low', label: 'Low' };
}
export function PriorityBadge({ score }) {
  const band = priorityBand(score);
  if (band.key === 'none') return <span className="muted small">—</span>;
  return (
    <span className={`prio prio--${band.key}`} title={`Priority ${score} of 100`}>
      <strong className="numeral">{score}</strong> {band.label}
    </span>
  );
}

export function DemoTag() {
  return null;
}

export function Alert({ type = 'info', title, children, className = '' }) {
  const Icon = { info: LuInfo, warn: LuTriangleAlert, error: LuCircleAlert, success: LuCircleCheck }[type];
  return (
    <div className={`alert alert--${type} ${className}`} role={type === 'error' ? 'alert' : undefined}>
      <Icon aria-hidden />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = LuInbox, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon aria-hidden />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty" role="alert">
      <div className="empty__icon">
        <LuCircleAlert aria-hidden />
      </div>
      <h3>{error?.status === 404 ? 'Not found' : 'This page could not be loaded'}</h3>
      <p>{error?.message || 'Something went wrong.'}</p>
      {onRetry && error?.status !== 404 && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="pagination__buttons">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <LuChevronLeft aria-hidden /> Previous
        </Button>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next <LuChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

// Accessible dialog: focus moves inside, Escape closes, background is inert.
export function Modal({ title, onClose, children, footer, labelledBy, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    const focusable = el?.querySelector('input, select, textarea, button:not(.modal__close)') || el;
    focusable?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (n) => !n.disabled,
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy || titleId} ref={ref} tabIndex={-1}>
        <div className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn modal__close" onClick={onClose} aria-label="Close">
            <LuX aria-hidden />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Facts({ items }) {
  return (
    <dl className="facts">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

export function fieldErrors(err) {
  return err?.fields || {};
}
