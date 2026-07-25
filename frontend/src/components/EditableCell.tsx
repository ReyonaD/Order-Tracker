import { useEffect, useRef, useState } from "react";

type CellType = "text" | "select" | "checkbox";

interface Props {
  value: string | boolean | null;
  editable: boolean;
  type: CellType;
  options?: string[];
  placeholder?: string;
  onCommit: (value: string | boolean | null) => void;
}

export default function EditableCell({
  value,
  editable,
  type,
  options = [],
  placeholder,
  onCommit,
}: Props) {
  if (type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={!editable}
        onChange={(e) => onCommit(e.target.checked)}
      />
    );
  }

  if (type === "select") {
    if (!editable) return <span>{(value as string) || ""}</span>;
    return (
      <select
        className="cell-select"
        value={(value as string) || ""}
        onChange={(e) => onCommit(e.target.value || null)}
      >
        <option value="">—</option>
        {/* Include current value even if it's no longer in the options list. */}
        {value && !options.includes(value as string) && (
          <option value={value as string}>{value as string}</option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <TextCell
      value={(value as string) || ""}
      editable={editable}
      placeholder={placeholder}
      onCommit={onCommit}
    />
  );
}

function TextCell({
  value,
  editable,
  placeholder,
  onCommit,
}: {
  value: string;
  editable: boolean;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  if (!editable) return <span>{value}</span>;

  if (!editing) {
    return (
      <span className="cell-editable" onClick={() => setEditing(true)}>
        {value || <span className="cell-placeholder">{placeholder || "—"}</span>}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft || null);
  };

  return (
    <input
      ref={ref}
      className="cell-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}
