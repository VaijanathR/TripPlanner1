import { useEffect, useRef, useState } from "react";
import { conditionsApi } from "../api/conditions";
import { daysApi } from "../api/days";
import ConditionsPanel from "./ConditionsPanel";

let localIdCounter = 0;
function nextLocalId() {
  localIdCounter -= 1;
  return localIdCounter;
}

function toDraftActivities(activities) {
  return activities.map((a) => ({ ...a, localId: a.id ?? nextLocalId() }));
}

// A snapshot of the fields a user can edit, to tell whether anything is unsaved.
const editableSnapshot = (date, location, notes, activities) =>
  JSON.stringify([
    date,
    location,
    notes ?? "",
    activities.map((a) => [a.title, (a.start_time ?? "").slice(0, 5), (a.end_time ?? "").slice(0, 5), a.notes ?? ""]),
  ]);

export default function DayEditor({ tripId, day, index, dayCount, onSaved, onDeleted, onMove, onDirtyChange }) {
  const [date, setDate] = useState(day.date);
  const [location, setLocation] = useState(day.location);
  const [notes, setNotes] = useState(day.notes ?? "");
  const [activities, setActivities] = useState(() => toDraftActivities(day.activities));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  function updateActivity(localId, patch) {
    setJustSaved(false);
    setActivities((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));
  }

  function addActivity() {
    setJustSaved(false);
    setActivities((prev) => [
      ...prev,
      { id: null, localId: nextLocalId(), title: "", start_time: "", end_time: "", notes: "" },
    ]);
  }

  function removeActivity(localId) {
    setJustSaved(false);
    setActivities((prev) => prev.filter((a) => a.localId !== localId));
  }

  const dirty =
    editableSnapshot(date, location, notes, activities) !==
    editableSnapshot(day.date, day.location, day.notes, day.activities);
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  useEffect(() => {
    onDirtyChangeRef.current?.(day.id, dirty);
    return () => onDirtyChangeRef.current?.(day.id, false);
  }, [dirty, day.id]);

  const timeInvalidActivity = activities.find(
    (a) => a.start_time && a.end_time && a.end_time < a.start_time
  );
  const hasEmptyRequiredField =
    !date || !location.trim() || activities.some((a) => !a.title.trim() || !a.start_time || !a.end_time);
  const canSave = !saving && !timeInvalidActivity && !hasEmptyRequiredField;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        date,
        location,
        notes: notes || null,
        activities: activities.map((a, i) => ({
          id: a.id,
          title: a.title,
          start_time: a.start_time,
          end_time: a.end_time,
          notes: a.notes || null,
          order_index: i,
        })),
      };
      const updated = await daysApi.update(tripId, day.id, payload);
      setActivities(toDraftActivities(updated.activities));
      setJustSaved(true);
      onSaved(updated);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this day and all of its activities?")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await daysApi.remove(tripId, day.id);
      onDeleted(day.id);
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="day-editor">
      <div className="day-editor-header">
        <h3>Day {index + 1}</h3>
        <div className="day-move-buttons">
          <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)}>
            ↑
          </button>
          <button type="button" disabled={index === dayCount - 1} onClick={() => onMove(index, 1)}>
            ↓
          </button>
        </div>
      </div>

      <div className="day-fields">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setJustSaved(false); }} />
        </label>
        <label>
          Location
          <input
            type="text"
            value={location}
            onChange={(e) => { setLocation(e.target.value); setJustSaved(false); }}
          />
        </label>
      </div>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setJustSaved(false); }} />
      </label>

      {/* Keyed by the saved location so a saved location change reloads it. */}
      <ConditionsPanel
        key={day.location}
        location={day.location}
        load={() => conditionsApi.forDay(tripId, day.id)}
      />

      <h4>Activities</h4>
      {activities.length === 0 && <p className="empty-state">No activities yet.</p>}
      <ul className="activity-list">
        {activities.map((a) => {
          const isInvalid = a.start_time && a.end_time && a.end_time < a.start_time;
          return (
            <li key={a.localId} className="activity-row">
              <input
                type="text"
                placeholder="Title"
                value={a.title}
                onChange={(e) => updateActivity(a.localId, { title: e.target.value })}
              />
              <input
                type="time"
                value={a.start_time}
                onChange={(e) => updateActivity(a.localId, { start_time: e.target.value })}
              />
              <input
                type="time"
                value={a.end_time}
                onChange={(e) => updateActivity(a.localId, { end_time: e.target.value })}
              />
              <input
                type="text"
                placeholder="Notes"
                value={a.notes ?? ""}
                onChange={(e) => updateActivity(a.localId, { notes: e.target.value })}
              />
              <button type="button" onClick={() => removeActivity(a.localId)}>
                Remove
              </button>
              {isInvalid && (
                <p className="inline-error">End time must not be before start time.</p>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={addActivity}>
        Add activity
      </button>

      <div className="day-editor-footer">
        <button type="button" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        {justSaved && !saving && <span className="saved-confirmation">Saved</span>}
        {hasEmptyRequiredField && !timeInvalidActivity && (
          <p className="inline-error">Date, location, and every activity's title/start/end time are required.</p>
        )}
        {saveError && (
          <p className="inline-error">
            {saveError} <button type="button" onClick={handleSave}>Retry</button>
          </p>
        )}
        <button type="button" className="delete-button" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete day"}
        </button>
        {deleteError && <p className="inline-error">{deleteError}</p>}
      </div>
    </div>
  );
}
