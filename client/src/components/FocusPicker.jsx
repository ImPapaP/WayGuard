// "Viewing" picker for administrators who cover more than one LGU (the
// platform administrator, regional and provincial administrators): narrow the
// whole workspace (dashboard, reports, map, exports, settings) to one LGU and
// the areas under it, or go back to everything.
import { useState } from 'react';
import { LuEye, LuX } from 'react-icons/lu';
import { useApi } from '../lib/hooks.js';
import { getFocusLgu, setFocusLgu } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { SearchSelect } from './ui.jsx';

const LEVEL = {
  island_group: 'Island group', region: 'Region', province: 'Province', independent_city: 'Independent city',
  special_area: 'Special area', city: 'City', municipality: 'Municipality', barangay: 'Barangay',
};

export default function FocusPicker() {
  const { user } = useAuth();
  const focus = getFocusLgu();
  const [choosing, setChoosing] = useState(false);
  const canFocus = user?.role === 'platform_admin' || user?.role === 'admin';
  // Regional or provincial administrators see it; an LGU admin with one LGU does not.
  const { data } = useApi(canFocus && (choosing || user?.role === 'admin') ? '/api/admin/jurisdictions' : null);
  if (!canFocus) return null;
  if (user.role === 'admin' && !focus && (!data || data.items.length <= 1)) return null;

  const apply = (lgu) => {
    setFocusLgu(lgu);
    window.location.reload();
  };
  const everything = user.role === 'platform_admin' ? 'All LGUs' : 'All my areas';

  return (
    <div className="focus-picker">
      <span className="focus-picker__label"><LuEye aria-hidden /> Viewing</span>
      {choosing ? (
        data ? (
          <SearchSelect
            id="focus-lgu"
            label="LGU to view"
            options={data.items.map((l) => ({ value: String(l.id), label: `${l.name} · ${LEVEL[l.jurisdiction_level] || ''}${l.province ? `, ${l.province}` : ''}` }))}
            value=""
            placeholder="Type a city, province or region"
            onChange={(e) => {
              const lgu = data.items.find((l) => String(l.id) === e.target.value);
              if (lgu) apply(lgu);
            }}
          />
        ) : (
          <span className="small">Loading…</span>
        )
      ) : (
        <div className="focus-picker__current">
          <strong>{focus?.name || everything}</strong>
          <button type="button" className="linkish" onClick={() => setChoosing(true)}>Change</button>
          {focus && (
            <button type="button" className="icon-btn icon-btn--sm" aria-label={`Stop focusing on ${focus.name}`} onClick={() => apply(null)}>
              <LuX aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
