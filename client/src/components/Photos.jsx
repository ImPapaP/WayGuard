// Photo gallery with a keyboard-friendly lightbox, and the photo picker used
// on the report and repair forms (camera capture on phones).
import { useEffect, useRef, useState } from 'react';
import { LuX, LuChevronLeft, LuChevronRight, LuCamera, LuImagePlus, LuTrash2 } from 'react-icons/lu';
import { compressImage } from '../lib/image.js';

const KIND_LABEL = { report: 'Reported', before: 'Before', progress: 'Progress', after: 'After' };

export function PhotoGrid({ photos, showKind = false }) {
  const [open, setOpen] = useState(null);
  if (!photos?.length) return <p className="muted small">No photos.</p>;
  return (
    <>
      <div className="photo-grid">
        {photos.map((p, i) => (
          <button
            type="button"
            key={p.id}
            className="photo-tile"
            onClick={() => setOpen(i)}
            aria-label={`Open photo ${i + 1} of ${photos.length}${showKind ? ` (${KIND_LABEL[p.kind]})` : ''}`}
          >
            <img src={p.thumb_url} alt="" loading="lazy" />
            {showKind && <span className="photo-tile__label">{KIND_LABEL[p.kind]}</span>}
          </button>
        ))}
      </div>
      {open !== null && <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

function Lightbox({ photos, index, onIndex, onClose }) {
  const closeRef = useRef(null);
  const p = photos[index];
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [index, photos.length, onClose, onIndex]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="lightbox__bar">
        <span>
          {KIND_LABEL[p.kind]} photo, {index + 1} of {photos.length}
        </span>
        <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close photo viewer">
          <LuX aria-hidden />
        </button>
      </div>
      <div className="lightbox__img" onClick={onClose}>
        <img src={p.url} alt={`${KIND_LABEL[p.kind]} photo ${index + 1}`} onClick={(e) => e.stopPropagation()} />
      </div>
      {photos.length > 1 && (
        <div className="lightbox__bar" style={{ justifyContent: 'center', gap: 16 }}>
          <button type="button" className="icon-btn" onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Previous photo">
            <LuChevronLeft aria-hidden />
          </button>
          <button type="button" className="icon-btn" onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next photo">
            <LuChevronRight aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

// Lets people take or choose photos. Files are compressed in the browser
// before they are added. `value` is an array of { file, url }.
export function PhotoPicker({ value, onChange, max = 5, maxMb = 8, label = 'Add photo', error, id }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  useEffect(
    () => () => {
      value.forEach((p) => URL.revokeObjectURL(p.url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function add(fileList) {
    setLocalError(null);
    const files = [...(fileList || [])];
    if (!files.length) return;
    const room = max - value.length;
    if (files.length > room) setLocalError(`Only ${max} photos are allowed; extra photos were skipped.`);
    setBusy(true);
    const next = [];
    for (const f of files.slice(0, room)) {
      if (!f.type.startsWith('image/')) {
        setLocalError(`"${f.name}" is not an image.`);
        continue;
      }
      const small = await compressImage(f);
      if (small.size > maxMb * 1024 * 1024) {
        setLocalError(`"${f.name}" is larger than ${maxMb} MB.`);
        continue;
      }
      next.push({ file: small, url: URL.createObjectURL(small) });
    }
    setBusy(false);
    onChange([...value, ...next]);
  }

  function remove(i) {
    URL.revokeObjectURL(value[i].url);
    onChange(value.filter((_, j) => j !== i));
  }

  const shownError = error || localError;
  return (
    <div>
      <div className="photo-grid" id={id}>
        {value.map((p, i) => (
          <div className="photo-tile" key={p.url} style={{ cursor: 'default' }}>
            <img src={p.url} alt={`Selected photo ${i + 1}`} />
            <button type="button" className="photo-tile__remove" onClick={() => remove(i)} aria-label={`Remove photo ${i + 1}`}>
              <LuTrash2 size={15} aria-hidden />
            </button>
          </div>
        ))}
        {value.length < max && (
          <>
            <button type="button" className="photo-add" onClick={() => cameraRef.current?.click()} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden /> : <LuCamera aria-hidden />}
              {busy ? 'Preparing…' : 'Take photo'}
            </button>
            <button type="button" className="photo-add" onClick={() => galleryRef.current?.click()} disabled={busy}>
              <LuImagePlus aria-hidden />
              {label}
            </button>
          </>
        )}
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="field__hint" style={{ marginTop: 8 }}>
        {value.length} of {max} photos. JPEG, PNG or WebP. Location data stored inside photos is removed when you submit.
      </p>
      {shownError && (
        <p className="field__error" role="alert">
          {shownError}
        </p>
      )}
    </div>
  );
}
