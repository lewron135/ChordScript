"use client";

import { useState, useRef, useEffect } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ChordToken from "./ChordToken";
import type { ChordEntry, InstrumentalRegion } from "@/types";

// ── Internal types ─────────────────────────────────────────────────────────────

interface AnnotatedWord {
  text: string;
  chordEntryIndex: number | null;
  activeChordIdx: number;
}

interface AnnotatedLine {
  words: AnnotatedWord[];
}

interface SongSection {
  label: string;
  lines: AnnotatedLine[];
  /** Set when section has no lyric lines — shows chord row only */
  instrumentalChordIndices?: number[];
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  chords: ChordEntry[];
  lyrics: string;
  duration: number;
  bpm: number;
  firestoreId?: string | null;
  activeChordIdx?: number;
  instrumentalRegions?: InstrumentalRegion[];
}

// ── Section label parsing ──────────────────────────────────────────────────────

function parseHeader(line: string): string | null {
  const t = line.trim();
  const bracketMatch = t.match(/^[\[({](.+?)[\])}]$/);
  if (bracketMatch) return bracketMatch[1].trim();
  const keywordMatch = t.match(
    /^(verse|chorus|bridge|pre-?chorus|intro|outro|coda|hook|refrain|vamp|tag|interlude|instrumental)[\s\d:]*$/i
  );
  if (keywordMatch) return t.replace(/:$/, "").trim();
  return null;
}

function parseLyricSections(lyrics: string): { label: string; lines: string[] }[] {
  if (!lyrics.trim()) return [];

  const paragraphs = lyrics.trim().split(/\n[ \t]*\n+/);
  const sections: { label: string; lines: string[] }[] = [];
  let verseIdx = 0;
  let pendingLabel: string | null = null;

  for (const para of paragraphs) {
    const rawLines = para.split("\n");
    const nonEmpty = rawLines.filter((l) => l.trim());
    if (!nonEmpty.length) continue;

    // Standalone single-line header paragraph
    if (nonEmpty.length === 1 && parseHeader(nonEmpty[0]) !== null) {
      // If there's already a pending label with no content, emit it as an instrumental section
      if (pendingLabel !== null) {
        sections.push({ label: pendingLabel, lines: [] });
      }
      pendingLabel = parseHeader(nonEmpty[0])!;
      continue;
    }

    let contentLines = rawLines;
    let label: string | null = pendingLabel;
    pendingLabel = null;

    const firstNonEmpty = rawLines.find((l) => l.trim());
    if (firstNonEmpty && parseHeader(firstNonEmpty) !== null) {
      // Flush any pending label as an instrumental section before this inline header takes over
      if (label !== null) sections.push({ label, lines: [] });
      label = parseHeader(firstNonEmpty)!;
      const firstIdx = rawLines.indexOf(firstNonEmpty);
      contentLines = rawLines.slice(firstIdx + 1);
    }

    const filtered = contentLines.map((l) => l.trimEnd()).filter((l) => l.trim());

    if (!label) {
      verseIdx++;
      label = `Verse ${verseIdx}`;
    }

    // Zero-word sections (pure headers like [Intro]) are kept with empty lines array
    sections.push({ label, lines: filtered });
  }

  // Handle a pending label at end of input (header with nothing below it)
  if (pendingLabel !== null) {
    sections.push({ label: pendingLabel, lines: [] });
  }

  if (!sections.length) {
    return [{ label: "Verse 1", lines: lyrics.split("\n").filter((l) => l.trim()) }];
  }

  return sections;
}

// ── Chord-to-lyric alignment ───────────────────────────────────────────────────

function findActiveChordIdx(chords: ChordEntry[], time: number): number {
  if (!chords.length) return 0;
  let lo = 0, hi = chords.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (chords[mid].start <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Returns all chord indices whose start falls in [tStart, tEnd) */
function chordsInRange(chords: ChordEntry[], tStart: number, tEnd: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < chords.length; i++) {
    if (chords[i].start >= tStart && chords[i].start < tEnd) result.push(i);
  }
  return result;
}

// ── Timeline building with instrumental region support ─────────────────────────

interface TimeSlot {
  type: "vocal" | "instrumental";
  start: number;
  end: number;
  label?: string; // for instrumental slots: "Intro" | "Interlude" | "Outro"
}

function buildTimeline(
  effectiveDuration: number,
  instrumentalRegions: InstrumentalRegion[]
): TimeSlot[] {
  // Filter to regions at least 4 s long, sort by start
  const sorted = [...instrumentalRegions]
    .filter((r) => r.end - r.start >= 4)
    .sort((a, b) => a.start - b.start);

  const slots: TimeSlot[] = [];
  let cursor = 0;

  for (const region of sorted) {
    if (region.start > cursor + 0.5) {
      slots.push({ type: "vocal", start: cursor, end: region.start });
    }
    // Determine label by position
    let label: string;
    if (region.start < effectiveDuration * 0.15) label = "Intro";
    else if (region.end > effectiveDuration * 0.85) label = "Outro";
    else label = "Interlude";

    slots.push({ type: "instrumental", start: region.start, end: region.end, label });
    cursor = region.end;
  }

  if (cursor < effectiveDuration - 0.5) {
    slots.push({ type: "vocal", start: cursor, end: effectiveDuration });
  }

  // If everything got swallowed (unlikely), fall back to one vocal slot
  if (!slots.length) {
    slots.push({ type: "vocal", start: 0, end: effectiveDuration });
  }

  return slots;
}

// ── Build lyric section for a single vocal slot ────────────────────────────────

function buildLyricSection(
  rawSec: { label: string; lines: string[] },
  chords: ChordEntry[],
  tStart: number,
  tEnd: number
): SongSection {
  type FlatWord = { lIdx: number; text: string };
  const flat: FlatWord[] = [];
  rawSec.lines.forEach((line, lIdx) =>
    line.split(/\s+/).filter(Boolean).forEach((text) => flat.push({ lIdx, text }))
  );

  const total = flat.length;
  let prevChordIdx = -1;
  const annotated = flat.map((w, i) => {
    const t = tStart + (i / total) * (tEnd - tStart);
    const activeChordIdx = findActiveChordIdx(chords, t);
    const chordChanged = activeChordIdx !== prevChordIdx;
    const chordEntryIndex = chordChanged || i === 0 ? activeChordIdx : null;
    prevChordIdx = activeChordIdx;
    return { ...w, activeChordIdx, chordEntryIndex };
  });

  return {
    label: rawSec.label,
    lines: rawSec.lines.map((_, lIdx) => ({
      words: annotated
        .filter((w) => w.lIdx === lIdx)
        .map(({ text, activeChordIdx, chordEntryIndex }) => ({
          text, activeChordIdx, chordEntryIndex,
        })),
    })),
  };
}

// ── Main section builder ───────────────────────────────────────────────────────

function buildSections(
  chords: ChordEntry[],
  lyrics: string,
  duration: number,
  instrumentalRegions: InstrumentalRegion[] = []
): SongSection[] {
  const rawSections = parseLyricSections(lyrics);
  if (!rawSections.length) return [];

  const effectiveDuration = duration > 0 ? duration : (chords[chords.length - 1]?.end ?? 60);

  if (!chords.length) {
    return rawSections.map((sec) => ({
      label: sec.label,
      lines: sec.lines.map((line) => ({
        words: line.split(/\s+/).filter(Boolean).map((text) => ({
          text, chordEntryIndex: null, activeChordIdx: 0,
        })),
      })),
    }));
  }

  // Separate explicitly-instrumental (zero-word) sections from lyric sections
  type RawSec = { label: string; lines: string[]; wordCount: number };
  const withCounts: RawSec[] = rawSections.map((s) => ({
    ...s,
    wordCount: s.lines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0),
  }));

  // ── Path A: instrumental regions from backend ──────────────────────────
  if (instrumentalRegions.length > 0) {
    const timeline = buildTimeline(effectiveDuration, instrumentalRegions);
    const vocalSlots = timeline.filter((s) => s.type === "vocal");
    const lyricOnlySections = withCounts.filter((s) => s.wordCount > 0);

    // Distribute lyric sections across vocal slots proportionally by word count
    const totalWords = lyricOnlySections.reduce((n, s) => n + s.wordCount, 0);
    const totalVocalTime = vocalSlots.reduce((n, s) => n + (s.end - s.start), 0);

    // Assign lyric sections to vocal slots
    const result: SongSection[] = [];
    let lyricIdx = 0;
    let lyricWordOffset = 0; // words consumed so far

    for (const slot of timeline) {
      if (slot.type === "instrumental") {
        result.push({
          label: slot.label!,
          lines: [],
          instrumentalChordIndices: chordsInRange(chords, slot.start, slot.end),
        });
        continue;
      }

      // Vocal slot: fill with proportional lyric sections
      const slotFrac = totalVocalTime > 0 ? (slot.end - slot.start) / totalVocalTime : 1;
      const wordsInSlot = Math.round(totalWords * slotFrac);
      let consumed = 0;

      while (lyricIdx < lyricOnlySections.length && consumed < wordsInSlot) {
        const sec = lyricOnlySections[lyricIdx];
        const secFrac = totalWords > 0 ? sec.wordCount / totalWords : 0;
        const secTime = totalVocalTime * secFrac;

        // Determine where this section sits within the vocal slot's time range
        const wordsBefore = lyricWordOffset;
        const tStart = slot.start + (wordsBefore / totalWords) * totalVocalTime;
        const tEnd = tStart + secTime;

        if (sec.wordCount > 0) {
          result.push(buildLyricSection(sec, chords, tStart, Math.min(tEnd, slot.end)));
        } else {
          // Explicitly-instrumental section within vocal slot (rare)
          result.push({
            label: sec.label,
            lines: [],
            instrumentalChordIndices: chordsInRange(chords, tStart, Math.min(tEnd, slot.end)),
          });
        }

        lyricWordOffset += sec.wordCount;
        consumed += sec.wordCount;
        lyricIdx++;
      }
    }

    // Any leftover lyric sections (edge case): append at end
    for (; lyricIdx < lyricOnlySections.length; lyricIdx++) {
      const sec = lyricOnlySections[lyricIdx];
      const t = effectiveDuration - 0.5;
      result.push(buildLyricSection(sec, chords, t, effectiveDuration));
    }

    return result;
  }

  // ── Path B: no backend regions — proportional distribution ────────────
  const lyricSections = withCounts.filter((s) => s.wordCount > 0);
  const avgWords =
    lyricSections.length > 0
      ? lyricSections.reduce((n, s) => n + s.wordCount, 0) / lyricSections.length
      : 12;

  const weights = withCounts.map((s) => (s.wordCount > 0 ? s.wordCount : avgWords));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const secRanges: { tStart: number; tEnd: number }[] = [];
  let cursor = 0;
  for (const w of weights) {
    const frac = w / totalWeight;
    secRanges.push({
      tStart: cursor * effectiveDuration,
      tEnd: (cursor + frac) * effectiveDuration,
    });
    cursor += frac;
  }

  return withCounts.map((rawSec, sIdx) => {
    const { tStart, tEnd } = secRanges[sIdx];

    if (rawSec.wordCount === 0) {
      return {
        label: rawSec.label,
        lines: [],
        instrumentalChordIndices: chordsInRange(chords, tStart, tEnd),
      };
    }

    return buildLyricSection(rawSec, chords, tStart, tEnd);
  });
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ChordSheet({
  chords,
  lyrics,
  duration,
  bpm,
  firestoreId,
  activeChordIdx,
  instrumentalRegions = [],
}: Props) {
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Ref to each chord-word div for auto-scroll in Phase 4
  const activeRef = useRef<HTMLDivElement | null>(null);

  const hasLyrics = lyrics.trim().length > 0;
  const sections = hasLyrics
    ? buildSections(chords, lyrics, duration, instrumentalRegions)
    : [];

  // Auto-scroll to active chord when karaoke plays
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeChordIdx]);

  function getChord(idx: number): string {
    return overrides[idx] ?? chords[idx]?.chord ?? "";
  }

  function persistOverrides(next: Record<number, string>) {
    setOverrides(next);
    if (!firestoreId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateDoc(doc(db, "songs", firestoreId), {
          chords: chords.map((e, i) => ({ ...e, chord: next[i] ?? e.chord })),
          lastEditedAt: new Date(),
        });
      } catch (err) {
        console.error("Firestore chord update failed:", err);
      }
    }, 1000);
  }

  function handleEdit(chordIdx: number, value: string) {
    persistOverrides({ ...overrides, [chordIdx]: value });
  }

  function handleReset(chordIdx: number) {
    const next = { ...overrides };
    delete next[chordIdx];
    persistOverrides(next);
  }

  const editCount = Object.keys(overrides).length;

  // ── Shared render helper for a single ChordToken ──────────────────────────

  function renderToken(chordIdx: number) {
    const isActive = activeChordIdx === chordIdx;
    return (
      <ChordToken
        key={chordIdx}
        chord={getChord(chordIdx)}
        originalChord={chords[chordIdx]?.chord ?? ""}
        isEdited={chordIdx in overrides}
        isActive={isActive}
        onChange={(v) => handleEdit(chordIdx, v)}
        onReset={() => handleReset(chordIdx)}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-100">Chord Chart</h2>
        {bpm > 0 && (
          <span className="text-[11px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-700">
            ♩ {Math.round(bpm)} BPM
          </span>
        )}
        <span className="text-[11px] text-zinc-500">{chords.length} chords</span>
        {editCount > 0 && (
          <span className="text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded-full">
            {editCount} edited
          </span>
        )}
        <span className="text-[11px] text-zinc-600 ml-auto hidden sm:block">
          Click any chord to edit · ↺ to reset
        </span>
      </div>

      {hasLyrics && sections.length > 0 ? (
        <div className="space-y-10">
          {sections.map((section, sIdx) => (
            <div key={sIdx}>
              {/* Section divider */}
              <div className="flex items-center gap-3 mb-5">
                <div className="h-px bg-zinc-800 w-4 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-400 shrink-0">
                  {section.label}
                </span>
                <div className="h-px bg-zinc-800 flex-1" />
              </div>

              {section.instrumentalChordIndices ? (
                /* Instrumental block — chord row, no lyric words */
                <div className="flex flex-wrap gap-2 py-2">
                  {section.instrumentalChordIndices.length > 0 ? (
                    section.instrumentalChordIndices.map((ci) => {
                      const isActive = activeChordIdx === ci;
                      return (
                        <div
                          key={ci}
                          ref={isActive ? activeRef : null}
                          className={`border rounded-lg px-3 pt-2.5 pb-2 min-w-[68px] text-center flex flex-col items-center gap-1 transition-colors ${
                            isActive
                              ? "bg-indigo-950/60 border-indigo-700"
                              : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                          }`}
                        >
                          {renderToken(ci)}
                          <div className="text-zinc-600 text-[10px] tabular-nums font-mono">
                            {chords[ci].start.toFixed(1)}s
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-zinc-600 italic">No chords detected in this range</p>
                  )}
                </div>
              ) : (
                /* Lyric lines with chords above words */
                <div className="space-y-6">
                  {section.lines.map((line, lIdx) => (
                    <div key={lIdx} className="chord-line">
                      {line.words.map((word, wIdx) => {
                        const isActive = word.chordEntryIndex !== null && activeChordIdx === word.chordEntryIndex;
                        return (
                          <div
                            key={wIdx}
                            className="chord-word"
                            ref={isActive ? activeRef : null}
                          >
                            <div className="h-[22px] flex items-end mb-[5px]">
                              {word.chordEntryIndex !== null && (
                                <ChordToken
                                  chord={getChord(word.chordEntryIndex)}
                                  originalChord={chords[word.chordEntryIndex]?.chord ?? ""}
                                  isEdited={word.chordEntryIndex in overrides}
                                  isActive={activeChordIdx === word.chordEntryIndex}
                                  onChange={(v) => handleEdit(word.chordEntryIndex!, v)}
                                  onReset={() => handleReset(word.chordEntryIndex!)}
                                />
                              )}
                            </div>
                            <span className="text-[15px] leading-none text-zinc-100 font-light tracking-wide select-text whitespace-nowrap">
                              {word.text}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : hasLyrics ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <pre className="text-[14px] text-zinc-200 whitespace-pre-wrap leading-7 font-light">{lyrics}</pre>
        </div>
      ) : (
        /* No lyrics: chord grid fallback */
        <div className="flex flex-wrap gap-2">
          {chords.map((entry, i) => {
            const isActive = activeChordIdx === i;
            return (
              <div
                key={i}
                ref={isActive ? activeRef : null}
                className={`border rounded-lg px-3 pt-2.5 pb-2 min-w-[68px] text-center flex flex-col items-center gap-1 transition-colors ${
                  isActive
                    ? "bg-indigo-950/60 border-indigo-700"
                    : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                {renderToken(i)}
                <div className="text-zinc-600 text-[10px] tabular-nums font-mono">
                  {entry.start.toFixed(1)}s
                </div>
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
