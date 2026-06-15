"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  chord: string;
  originalChord: string;
  isEdited: boolean;
  /** Highlighted when this chord is the one currently playing (Phase 4) */
  isActive?: boolean;
  onChange: (chord: string) => void;
  onReset: () => void;
}

export default function ChordToken({
  chord,
  originalChord,
  isEdited,
  isActive = false,
  onChange,
  onReset,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chord);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when chord changes externally (e.g. reset)
  useEffect(() => {
    if (!editing) setDraft(chord);
  }, [chord, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function confirm() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== chord) onChange(trimmed);
    setEditing(false);
  }

  function cancel() {
    setDraft(chord);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
          if (e.key === "Escape") cancel();
        }}
        onBlur={confirm}
        className={`
          w-[84px] font-mono text-[13px] font-bold
          bg-zinc-800 border border-amber-500 rounded px-1.5 py-0.5
          text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50
          leading-none
        `}
      />
    );
  }

  return (
    <span className="group/token inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to edit chord"
        className={`
          font-mono text-[13px] font-bold leading-none tracking-tight
          rounded px-0.5 transition-all duration-150 cursor-pointer
          ${
            isActive
              ? "text-white bg-indigo-600 px-1.5 py-0.5 scale-110 shadow-lg shadow-indigo-900/50"
              : isEdited
                ? "text-amber-300 underline decoration-dashed decoration-amber-600/70 underline-offset-2 hover:text-amber-200"
                : "text-amber-400 hover:text-amber-300 hover:bg-amber-400/10 px-0.5 py-0"
          }
        `}
      >
        {chord}
      </button>

      {/* Reset button — visible on hover only when edited */}
      {isEdited && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
          title={`Reset to ${originalChord}`}
          className="
            opacity-0 group-hover/token:opacity-100 transition-opacity duration-100
            text-zinc-500 hover:text-zinc-300 text-[11px] leading-none
            -mt-0.5 cursor-pointer
          "
        >
          ↺
        </button>
      )}
    </span>
  );
}
