"use client";

import { useState, useRef, useCallback } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
  uploadAudio,
  recognizeChordsFromPath,
  detectBeatsFromPath,
  separateStemsFromPath,
} from "@/lib/api";
import ChordSheet from "@/components/ChordSheet";
import StemPlayer, { type StemPlayerHandle } from "@/components/StemPlayer";
import type { AnalysisResult, StemResult, StepsState, StepStatus, ChordEntry } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCEPTED = ".wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg";

const INITIAL_STEPS: StepsState = {
  upload: "pending",
  chords: "pending",
  beats: "pending",
  stems: "pending",
  save: "pending",
};

const STEP_DEFS: { id: keyof StepsState; label: string; hint?: string }[] = [
  { id: "upload", label: "Uploading audio" },
  { id: "chords", label: "Detecting chords" },
  { id: "beats", label: "Detecting beats" },
  { id: "stems", label: "Separating stems", hint: "This may take 1–2 minutes" },
  { id: "save", label: "Saving to library" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function MusicalNoteIcon() {
  return (
    <svg
      className="w-5 h-5 text-indigo-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
      />
    </svg>
  );
}

function FileInput({
  label,
  hint,
  value,
  onChange,
  required,
  disabled,
}: {
  label: string;
  hint?: string;
  value: File | null;
  onChange: (f: File | null) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-300 mb-1">
        {label}
        {required && <span className="text-indigo-400 text-xs">required</span>}
      </label>
      {hint && <p className="text-xs text-zinc-500 mb-2 leading-relaxed">{hint}</p>}
      <input
        type="file"
        accept={ACCEPTED}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="
          block w-full text-sm text-zinc-400 cursor-pointer
          file:mr-3 file:py-1.5 file:px-3
          file:rounded-md file:border-0
          file:text-xs file:font-medium
          file:bg-indigo-600 file:text-white
          hover:file:bg-indigo-500 file:transition-colors file:cursor-pointer
          disabled:opacity-40 disabled:cursor-not-allowed
        "
      />
      {value && (
        <p className="mt-1.5 text-xs text-zinc-500 flex items-center gap-1.5 truncate">
          <span className="text-green-400 shrink-0">✓</span>
          <span className="truncate">{value.name}</span>
        </p>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done")
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/20 border border-green-500 text-green-400 text-[10px]">
        ✓
      </span>
    );
  if (status === "active")
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 border border-indigo-500">
        <span className="animate-spin text-white text-[10px] inline-block leading-none">
          ⟳
        </span>
      </span>
    );
  if (status === "error")
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/20 border border-red-500 text-red-400 text-[10px]">
        ✕
      </span>
    );
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-700" />
  );
}

function ProgressStepper({
  steps,
  stemsLoading,
}: {
  steps: StepsState;
  stemsLoading: boolean;
}) {
  const doneCount = Object.values(steps).filter((s) => s === "done").length;
  const pct = Math.round((doneCount / STEP_DEFS.length) * 100);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      {/* Progress bar */}
      <div className="h-0.5 bg-zinc-800 rounded-full mb-5 overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step list */}
      <ol className="space-y-0">
        {STEP_DEFS.map(({ id, label, hint }, i) => {
          const status = steps[id];
          const isActive = status === "active";
          const isDone = status === "done";
          const isLast = i === STEP_DEFS.length - 1;

          return (
            <li key={id} className="flex gap-3">
              <div className="flex flex-col items-center pt-0.5">
                <StepIcon status={status} />
                {!isLast && (
                  <div
                    className={`w-px mt-1 mb-1 transition-colors duration-500 ${
                      isDone ? "bg-green-700/50" : "bg-zinc-800"
                    }`}
                    style={{ height: "20px" }}
                  />
                )}
              </div>
              <div className="pb-1">
                <span
                  className={`text-sm ${
                    isDone
                      ? "text-green-400"
                      : isActive
                        ? "text-white font-medium"
                        : "text-zinc-600"
                  }`}
                >
                  {label}
                </span>
                {hint && isActive && (
                  <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>
                )}
                {id === "stems" && stemsLoading && isActive && (
                  <p className="text-xs text-zinc-600 mt-0.5 animate-pulse">
                    Running in background — chart ready while this completes
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [fullMix, setFullMix] = useState<File | null>(null);
  const [harmonicStem, setHarmonicStem] = useState<File | null>(null);
  const [lyrics, setLyrics] = useState("");

  const [running, setRunning] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepsState>(INITIAL_STEPS);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [stemsResult, setStemsResult] = useState<StemResult | null>(null);
  const [stemsLoading, setStemsLoading] = useState(false);

  const [activeChordIdx, setActiveChordIdx] = useState<number | undefined>(undefined);
  const stemPlayerRef = useRef<StemPlayerHandle>(null);
  const signedIn = useRef(false);

  const handleTimeUpdate = useCallback(
    (t: number) => {
      if (!result?.chords.chords.length) return;
      const chords: ChordEntry[] = result.chords.chords;
      let lo = 0, hi = chords.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (chords[mid].start <= t) lo = mid;
        else hi = mid - 1;
      }
      setActiveChordIdx(lo);
    },
    [result]
  );

  function setStep(id: keyof StepsState, status: StepStatus) {
    setSteps((prev) => ({ ...prev, [id]: status }));
  }

  async function ensureAuth() {
    if (!signedIn.current) {
      await signInAnonymously(auth);
      signedIn.current = true;
    }
  }

  async function handleAnalyze() {
    if (!fullMix) {
      setAnalysisError("Please select a Full Mix file.");
      return;
    }

    setRunning(true);
    setAnalysisError(null);
    setResult(null);
    setStemsResult(null);
    setStemsLoading(false);
    setSteps(INITIAL_STEPS);

    try {
      // ── Step 1: Upload ──────────────────────────────────────────────────
      setStep("upload", "active");
      const { full_mix_path, harmonic_path } = await uploadAudio(fullMix, harmonicStem);
      setStep("upload", "done");

      // ── Steps 2 & 3: Chords + beats in parallel ─────────────────────────
      setStep("chords", "active");
      setStep("beats", "active");

      const chordPath = harmonic_path ?? full_mix_path;

      const [chordsResult, beatsResult] = await Promise.all([
        recognizeChordsFromPath(chordPath).then((r) => {
          setStep("chords", r.success ? "done" : "error");
          return r;
        }),
        detectBeatsFromPath(full_mix_path).then((r) => {
          setStep("beats", r.success ? "done" : "error");
          return r;
        }),
      ]);

      if (!chordsResult.success)
        throw new Error(chordsResult.error ?? "Chord recognition failed");
      if (!beatsResult.success)
        throw new Error(beatsResult.error ?? "Beat detection failed");

      // ── Step 4: Stem separation (non-blocking) ──────────────────────────
      setStep("stems", "active");
      setStemsLoading(true);
      separateStemsFromPath(full_mix_path)
        .then((r) => {
          setStemsResult(r);
          setStep("stems", r.success ? "done" : "error");
        })
        .catch((e) => {
          console.error("Stem separation error:", e);
          setStep("stems", "error");
          setStemsResult({ success: false, error: String(e) } as StemResult);
        })
        .finally(() => setStemsLoading(false));

      // ── Step 5: Save to Firestore ───────────────────────────────────────
      setStep("save", "active");
      let firestoreId: string | null = null;
      try {
        await ensureAuth();
        const docRef = await addDoc(collection(db, "songs"), {
          createdAt: serverTimestamp(),
          lyrics,
          chords: chordsResult.chords,
          total_chords: chordsResult.total_chords,
          bpm: beatsResult.bpm,
          time_signature: beatsResult.time_signature,
          model_used: chordsResult.model_used,
        });
        firestoreId = docRef.id;
      } catch (err) {
        console.warn("Firestore save failed (non-fatal):", err);
      }
      setStep("save", "done");

      setResult({ chords: chordsResult, beats: beatsResult, lyrics, firestoreId });
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const showProgress = running || result !== null || stemsLoading;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── App header ─────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-900 sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <MusicalNoteIcon />
          <div>
            <h1 className="text-base font-bold tracking-tight leading-none text-zinc-100">
              ChordScript
            </h1>
            <p className="text-[11px] text-zinc-500 leading-none mt-0.5">
              Worship chord chart generator
            </p>
          </div>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Upload form */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-2xl mx-auto space-y-5">
          <div className="mb-1">
            <h2 className="text-sm font-semibold text-zinc-300">Analyze a song</h2>
            <p className="text-xs text-zinc-600 mt-0.5">
              Upload audio to detect chords, beats, and separate stems.
            </p>
          </div>

          <FileInput
            label="Full Mix"
            required
            value={fullMix}
            onChange={setFullMix}
            disabled={running}
          />
          <FileInput
            label="Harmonic Stem"
            hint="Optional — piano, strings or guitar stem for better chord accuracy."
            value={harmonicStem}
            onChange={setHarmonicStem}
            disabled={running}
          />

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Lyrics
            </label>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              rows={8}
              placeholder={"[Verse 1]\nPaste or type song lyrics here…\n\n[Chorus]\nChords will align above each word."}
              disabled={running}
              className="
                w-full rounded-xl bg-zinc-800/60 border border-zinc-700
                text-sm text-zinc-100 placeholder-zinc-600
                px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50
                focus:border-indigo-600 resize-y disabled:opacity-40
                transition-colors leading-relaxed
              "
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={running}
            className="
              w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500
              disabled:opacity-40 disabled:cursor-not-allowed
              text-white font-semibold text-sm transition-colors
              shadow-lg shadow-indigo-900/30
            "
          >
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin inline-block">⟳</span>
                Analyzing…
              </span>
            ) : (
              "Analyze"
            )}
          </button>

          {analysisError && (
            <p className="text-red-400 text-sm bg-red-950/50 border border-red-800/60 rounded-lg px-3 py-2">
              {analysisError}
            </p>
          )}
        </div>

        {/* Progress stepper */}
        {showProgress && (
          <div className="max-w-2xl mx-auto">
            <ProgressStepper steps={steps} stemsLoading={stemsLoading} />
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-10 pt-2">
            {result.firestoreId && (
              <p className="text-xs text-zinc-600 max-w-2xl mx-auto">
                Saved ·{" "}
                <code className="text-zinc-500 font-mono">{result.firestoreId}</code>
              </p>
            )}

            {/* Chord sheet — full width for the lead sheet layout */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 sm:p-8">
              <ChordSheet
                chords={result.chords.chords}
                lyrics={result.lyrics}
                duration={result.chords.duration}
                bpm={result.beats.bpm}
                firestoreId={result.firestoreId}
                activeChordIdx={activeChordIdx}
                instrumentalRegions={stemsResult?.instrumental_regions}
              />
            </div>

            {/* Stem player */}
            <StemPlayer
              ref={stemPlayerRef}
              stems={stemsResult?.stems ?? {}}
              isLoading={stemsLoading}
              onTimeUpdate={handleTimeUpdate}
            />
          </div>
        )}
      </main>
    </div>
  );
}
