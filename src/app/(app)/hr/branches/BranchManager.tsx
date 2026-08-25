'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CALENDAR_DAY_KIND_LABELS,
  WEEKDAY_LABELS,
  type Branch,
  type BranchCalendarDay,
  type CalendarDayKind,
} from '@/lib/types';

/**
 * Branch setup and QR code issuing (spec §14 phase 3 / §7.1), plus weekly
 * schedule and holiday-calendar management (branch-scoped HR feature).
 *
 * The printable QR is fetched from an HR-only endpoint and shown with its
 * branch name, so HR can print one sheet per entrance.
 */
export function BranchManager({
  initialBranches,
  calendarDays,
  manageableBranchIds,
  canCreate,
}: {
  initialBranches: Branch[];
  calendarDays: BranchCalendarDay[];
  manageableBranchIds: Set<string>;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(canCreate && initialBranches.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<Branch | null>(null);

  const [form, setForm] = useState({
    name: '',
    latitude: '',
    longitude: '',
    radius_meters: '100',
  });

  async function createBranch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/hr/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not create the branch.');
      setBusy(false);
      return;
    }

    setForm({ name: '', latitude: '', longitude: '', radius_meters: '100' });
    setShowForm(false);
    setBusy(false);
    router.refresh();
  }

  async function rotate(branch: Branch) {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/hr/branches/${branch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rotate: true }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not rotate the QR code.');
    }

    setBusy(false);
    setPrinting(null);
    router.refresh();
  }

  /** Fills the coordinate fields from the device, for setup done on-site. */
  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (pos) =>
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        })),
      () => setError('Could not read your location.'),
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
            Branches
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Each branch has its own geofence, weekly schedule, and signed QR
            code.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : 'Add branch'}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      {canCreate && showForm && (
        <form onSubmit={createBranch} className="card mt-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="name" className="field-label">
                Branch name
              </label>
              <input
                id="name"
                className="field"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Downtown Branch"
                required
              />
            </div>
            <div>
              <label htmlFor="latitude" className="field-label">
                Latitude
              </label>
              <input
                id="latitude"
                className="field"
                inputMode="decimal"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="longitude" className="field-label">
                Longitude
              </label>
              <input
                id="longitude"
                className="field"
                inputMode="decimal"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="radius" className="field-label">
                Geofence radius (metres)
              </label>
              <input
                id="radius"
                className="field"
                inputMode="numeric"
                value={form.radius_meters}
                onChange={(e) =>
                  setForm({ ...form, radius_meters: e.target.value })
                }
                required
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                100 m suits most sites. Too tight and honest staff get flagged.
              </p>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={useMyLocation}
              >
                Use my current location
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary mt-4" disabled={busy}>
            {busy ? 'Saving…' : 'Create branch'}
          </button>
        </form>
      )}

      {initialBranches.length === 0 ? (
        <p className="card mt-5 p-10 text-center text-ink-muted">
          No branches yet.{' '}
          {canCreate
            ? 'Add one to generate its check-in QR code.'
            : 'Ask a super administrator to add one.'}
        </p>
      ) : (
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {initialBranches.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              canManage={manageableBranchIds.has(branch.id)}
              calendarDays={calendarDays.filter((d) => d.branch_id === branch.id)}
              busy={busy}
              onShowQr={() => setPrinting(branch)}
              onRotate={() => rotate(branch)}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {printing && (
        <QrDialog branch={printing} onClose={() => setPrinting(null)} />
      )}
    </div>
  );
}

function BranchCard({
  branch,
  canManage,
  calendarDays,
  busy,
  onShowQr,
  onRotate,
  onError,
}: {
  branch: Branch;
  canManage: boolean;
  calendarDays: BranchCalendarDay[];
  busy: boolean;
  onShowQr: () => void;
  onRotate: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [offDays, setOffDays] = useState<number[]>(branch.weekly_off_days);
  const [expectedStart, setExpectedStart] = useState(branch.expected_start_time?.slice(0, 5) ?? '');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [calendarForm, setCalendarForm] = useState({
    date: '',
    kind: 'holiday' as CalendarDayKind,
    label: '',
  });
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function toggleOffDay(day: number) {
    setOffDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  async function saveSchedule() {
    setSavingSchedule(true);
    const response = await fetch(`/api/hr/branches/${branch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: branch.name,
        latitude: branch.latitude,
        longitude: branch.longitude,
        radius_meters: branch.radius_meters,
        weeklyOffDays: offDays,
        expectedStartTime: expectedStart || null,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      onError(data.error ?? 'Could not save the schedule.');
    }
    setSavingSchedule(false);
    router.refresh();
  }

  async function addCalendarDay(e: React.FormEvent) {
    e.preventDefault();
    if (!calendarForm.date) return;
    setSavingCalendar(true);

    const response = await fetch(`/api/hr/branches/${branch.id}/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: calendarForm.date,
        kind: calendarForm.kind,
        label: calendarForm.label || undefined,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      onError(data.error ?? 'Could not save the calendar day.');
    } else {
      setCalendarForm({ date: '', kind: 'holiday', label: '' });
    }

    setSavingCalendar(false);
    router.refresh();
  }

  async function removeCalendarDay(id: string) {
    setRemovingId(id);
    const response = await fetch(
      `/api/hr/branches/${branch.id}/calendar?calendarId=${id}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      onError(data.error ?? 'Could not remove the calendar day.');
    }
    setRemovingId(null);
    router.refresh();
  }

  return (
    <li className="card p-5">
      <h2 className="font-bold text-brand-secondary">{branch.name}</h2>
      <dl className="mt-2 space-y-1 text-sm text-ink-muted">
        <div>
          {Number(branch.latitude).toFixed(6)}, {Number(branch.longitude).toFixed(6)}
        </div>
        <div>{branch.radius_meters} m geofence</div>
        <div className="text-xs text-ink-faint">QR revision {branch.qr_version}</div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onShowQr}>
          Show QR code
        </button>
        {canManage && (
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={onRotate}
          >
            Rotate code
          </button>
        )}
      </div>

      {canManage && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
            Weekly off days
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                className={`px-2.5 py-1 text-xs font-semibold ${
                  offDays.includes(day)
                    ? 'bg-brand-primary-soft text-brand-primary'
                    : 'bg-surface-muted text-ink-muted'
                }`}
                onClick={() => toggleOffDay(day)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <label className="field-label text-xs" htmlFor={`start-${branch.id}`}>
              Expected start time{' '}
              <span className="font-normal text-ink-faint">(optional — for late-arrival display)</span>
            </label>
            <input
              id={`start-${branch.id}`}
              type="time"
              className="field w-32 text-sm"
              value={expectedStart}
              onChange={(e) => setExpectedStart(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn-secondary mt-2"
            disabled={savingSchedule}
            onClick={saveSchedule}
          >
            {savingSchedule ? 'Saving…' : 'Save schedule'}
          </button>

          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-ink-muted">
            Holidays &amp; special workdays
          </p>
          {calendarDays.length > 0 && (
            <ul className="mt-2 space-y-1">
              {calendarDays.map((day) => (
                <li
                  key={day.id}
                  className="flex items-center justify-between gap-2 text-sm text-ink-muted"
                >
                  <span>
                    {day.date} — {CALENDAR_DAY_KIND_LABELS[day.kind]}
                    {day.label ? ` (${day.label})` : ''}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-status-flagged"
                    disabled={removingId === day.id}
                    onClick={() => removeCalendarDay(day.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addCalendarDay} className="mt-2 flex flex-wrap items-end gap-2">
            <input
              type="date"
              className="field text-sm"
              value={calendarForm.date}
              onChange={(e) => setCalendarForm({ ...calendarForm, date: e.target.value })}
              required
            />
            <select
              className="field text-sm"
              value={calendarForm.kind}
              onChange={(e) =>
                setCalendarForm({
                  ...calendarForm,
                  kind: e.target.value as CalendarDayKind,
                })
              }
            >
              <option value="holiday">Holiday</option>
              <option value="mandatory_workday">Mandatory workday</option>
            </select>
            <input
              type="text"
              className="field text-sm"
              placeholder="Label (optional)"
              value={calendarForm.label}
              onChange={(e) => setCalendarForm({ ...calendarForm, label: e.target.value })}
            />
            <button type="submit" className="btn-secondary" disabled={savingCalendar}>
              {savingCalendar ? 'Adding…' : 'Add'}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

function QrDialog({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-secondary/70 p-4 print:static print:bg-transparent print:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`QR code for ${branch.name}`}
    >
      <div className="w-full max-w-sm bg-surface p-6 text-center print:max-w-none">
        <h2 className="text-lg font-bold text-brand-secondary">{branch.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Scan to check in or out
        </p>

        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic,
            HR-only, no-store endpoint; next/image would try to cache it. */}
        <img
          src={`/api/hr/branches/${branch.id}/qr`}
          alt={`Check-in QR code for ${branch.name}`}
          className="mx-auto mt-4 aspect-square w-full max-w-xs"
        />

        <p className="mt-3 text-xs text-ink-faint">
          Revision {branch.qr_version} · Print and mount at the entrance
        </p>

        <div className="mt-5 flex gap-2 print:hidden">
          <button
            type="button"
            className="btn-primary flex-1"
            onClick={() => window.print()}
          >
            Print
          </button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
