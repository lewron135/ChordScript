"use client";

import type { ChordEntry } from "@/types";

interface Props {
  chords: ChordEntry[];
  lyrics: string;
  bpm: number;
}

export default function ChordChart({ chords, lyrics, bpm }: Props) {
  const lyricLines = lyrics.trim() ? lyrics.split("\n") : [];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">Chord Chart</h2>
        {bpm > 0 && (
          <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">
            {Math.round(bpm)} BPM
          </span>
        )}
        <span className="text-xs text-gray-500">{chords.length} chords</span>
      </div>

      {/* Chord grid */}
      <div className="flex flex-wrap gap-2">
        {chords.map((entry, i) => (
          <div
            key={i}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 min-w-[64px] text-center"
          >
            <div className="text-white font-bold text-sm">{entry.chord}</div>
            <div className="text-gray-500 text-xs mt-0.5">
              {entry.start.toFixed(1)}s
            </div>
          </div>
        ))}
      </div>

      {/* Lyrics */}
      {lyricLines.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Lyrics</h3>
          <div className="bg-gray-800 rounded-md p-4 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed font-mono">
            {lyrics}
          </div>
        </div>
      )}
    </section>
  );
}
