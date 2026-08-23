import { useEffect, useRef, useState } from 'react';
import api from '../api';

/**
 * EventFormModal — create or edit an event.
 *
 * `event` null  → create mode (POST /organiser/events)
 * `event` set   → edit mode   (PATCH /organiser/events/:id)
 *
 * `organisers` is non-empty only for admins; it lets them publish under another
 * organiser's account. Organisers never see the field and the server rejects the
 * parameter from them regardless.
 */

const EMPTY = {
  title: '',
  type: 'MOVIE',
  language: '',
  duration_min: '',
  poster_url: '',
  description: '',
  organiserId: '',
};

export default function EventFormModal({ event, organisers = [], currentUser, onClose, onSaved }) {
  const isEdit = Boolean(event);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const titleRef = useRef(null);

  // Seed the form from the event being edited. Null columns become '' so the inputs
  // stay controlled — React warns loudly the moment one flips to undefined.
  useEffect(() => {
    setForm(event
      ? {
          title: event.title ?? '',
          type: event.type ?? 'MOVIE',
          language: event.language ?? '',
          duration_min: event.duration_min ?? '',
          poster_url: event.poster_url ?? '',
          description: event.description ?? '',
          organiserId: '',
        }
      : EMPTY);
    setError(null);
    setFieldErrors({});
  }, [event]);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // The page behind a modal must not scroll under it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const set = (key) => (e) => {
    const { value } = e.target;
    setForm(f => ({ ...f, [key]: value }));
    setFieldErrors(fe => (fe[key] ? { ...fe, [key]: null } : fe));
  };

  /** Mirror of the server's rules, so the user is told before a round trip. */
  const validateLocal = () => {
    const errs = {};
    if (form.title.trim().length < 2) errs.title = 'Title must be at least 2 characters.';
    if (form.duration_min !== '') {
      const n = Number(form.duration_min);
      if (!Number.isFinite(n) || n < 1) errs.duration_min = 'Duration must be a positive number of minutes.';
    }
    if (form.poster_url && !/^https?:\/\/\S+$/i.test(form.poster_url.trim())) {
      errs.poster_url = 'Poster must be a full http(s) URL, or left blank.';
    }
    return errs;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    const errs = validateLocal();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    // Only send what the user filled in: the PATCH uses COALESCE, so an empty string
    // would otherwise blank a column the user never touched.
    const payload = {
      title: form.title.trim(),
      type: form.type,
    };
    if (form.language.trim())    payload.language = form.language.trim();
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.poster_url.trim())  payload.poster_url = form.poster_url.trim();
    if (form.duration_min !== '') payload.duration_min = Number(form.duration_min);
    if (!isEdit && form.organiserId) payload.organiserId = form.organiserId;

    setSaving(true);
    try {
      const saved = isEdit
        ? await api.patch(`/organiser/events/${event.id}`, payload)
        : await api.post('/organiser/events', payload);
      onSaved(saved, { created: !isEdit });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="event-modal-title">
        <div className="modal-header">
          <div>
            <h3 id="event-modal-title">{isEdit ? 'Edit event' : 'Create event'}</h3>
            <p className="text-sm text-muted">
              {isEdit
                ? 'Update the details customers see on the event page.'
                : 'Step 1 of 2 — describe the event, then schedule its first show.'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={submit} className="modal-body">
          {error && <div className="alert alert-error mb-4">{error}</div>}

          <div className="form-grid">
            <div className="form-group span-2">
              <label className="form-label" htmlFor="ev-title">Title *</label>
              <input
                id="ev-title" ref={titleRef} className="form-input" required
                placeholder="e.g. Dune: Part Three"
                value={form.title} onChange={set('title')}
              />
              {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ev-type">Type *</label>
              <select id="ev-type" className="form-input" value={form.type} onChange={set('type')}>
                <option value="MOVIE">Movie</option>
                <option value="CONCERT">Concert</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ev-lang">Language</label>
              <input id="ev-lang" className="form-input" placeholder="English" value={form.language} onChange={set('language')} />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ev-dur">Duration (minutes)</label>
              <input
                id="ev-dur" type="number" min="1" className="form-input" placeholder="150"
                value={form.duration_min} onChange={set('duration_min')}
              />
              {fieldErrors.duration_min && <span className="field-error">{fieldErrors.duration_min}</span>}
            </div>

            {!isEdit && organisers.length > 0 && (
              <div className="form-group">
                <label className="form-label" htmlFor="ev-org">Publish as</label>
                <select id="ev-org" className="form-input" value={form.organiserId} onChange={set('organiserId')}>
                  <option value="">Myself ({currentUser?.name})</option>
                  {organisers.filter(o => o.id !== currentUser?.id).map(o => (
                    <option key={o.id} value={o.id}>{o.name} — {o.email}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group span-2">
              <label className="form-label" htmlFor="ev-poster">Poster image URL</label>
              <input
                id="ev-poster" className="form-input" placeholder="https://…/poster.jpg"
                value={form.poster_url} onChange={set('poster_url')}
              />
              {fieldErrors.poster_url
                ? <span className="field-error">{fieldErrors.poster_url}</span>
                : <span className="text-xs text-dim">Optional. Leave blank for a generated gradient poster.</span>}
            </div>

            <div className="form-group span-2">
              <label className="form-label" htmlFor="ev-desc">Description</label>
              <textarea
                id="ev-desc" className="form-input" rows={4}
                placeholder="What should customers know about this event?"
                value={form.description} onChange={set('description')}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create & schedule show'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
