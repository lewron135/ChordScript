"use client";

import {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { stemUrl } from "@/lib/api";
import type { StemUrls } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StemPlayerHandle {
  getCurrentTime: () => number;
}

interface TrackState {
  muted: boolean;
  solo: boolean;
  volume: number; // 0–1
}

interface AudioTrack {
  key: keyof StemUrls;
  label: string;
  /** Hex color — applied to the track dot and WaveSurfer waveform */
  color: string;
}

interface Props {
  stems: Partial<StemUrls>;
  isLoading: boolean;
  onTimeUpdate?: (t: number) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TRACKS: AudioTrack[] = [
  { key: "vocals",  label: "Vocals",        color: "#6366f1" }, // indigo
  { key: "drums",   label: "Drums",         color: "#f59e0b" }, // amber
  { key: "bass",    label: "Bass",          color: "#10b981" }, // emerald
  { key: "other",   label: "Guitar & Piano", color: "#ec4899" }, // pink
];

const DEFAULT_TRACK: TrackState = { muted: false, solo: false, volume: 0.8 };

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ── WaveformBar ────────────────────────────────────────────────────────────────
// Purely visual: WaveSurfer renders the waveform shape; actual audio runs
// through Web Audio API in the parent so timing stays sample-accurate.

interface WaveformProps {
  url: string | undefined;
  color: string;
  progress: number; // 0–1
}

function WaveformBar({ url, color, progress }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<import("wavesurfer.js").default | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!url || !containerRef.current) return;
    let cancelled = false;
    let ws: import("wavesurfer.js").default | null = null;

    (async () => {
      const WaveSurfer = (await import("wavesurfer.js")).default;
      if (cancelled || !containerRef.current) return;
      ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: color + "44",
        progressColor: color + "cc",
        cursorWidth: 0,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 40,
        normalize: true,
        interact: false,
      });
      ws.on("ready", () => { if (!cancelled) setReady(true); });
      ws.load(url);
      wsRef.current = ws;
    })();

    return () => {
      cancelled = true;
      ws?.destroy();
      wsRef.current = null;
      setReady(false);
    };
  }, [url, color]);

  // Drive the visual playhead position from master clock
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    try { ws.seekTo(Math.max(0, Math.min(1, progress))); } catch { /* not ready */ }
  }, [progress, ready]);

  return (
    <div className="relative flex-1 h-10 rounded overflow-hidden bg-zinc-800/30">
      {!ready && url && (
        <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
          <div className="h-px w-full" style={{ background: color + "33" }} />
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

// ── VolumeSlider ───────────────────────────────────────────────────────────────

function VolumeSlider({
  value,
  color,
  onChange,
}: {
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 w-[88px] shrink-0">
      {/* Speaker icon */}
      <svg
        className="w-3 h-3 shrink-0 opacity-40"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
      </svg>
      <input
        type="range"
        min={0}
        max={1}
        step={0.02}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ accentColor: color }}
        className="flex-1 h-0.5 cursor-pointer appearance-auto"
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const StemPlayer = forwardRef<StemPlayerHandle, Props>(function StemPlayer(
  { stems, isLoading, onTimeUpdate },
  ref
) {
  // ── Web Audio state ────────────────────────────────────────────────────
  const ctxRef   = useRef<AudioContext | null>(null);
  const buffers  = useRef<Partial<Record<keyof StemUrls, AudioBuffer>>>({});
  const sources  = useRef<Partial<Record<keyof StemUrls, AudioBufferSourceNode>>>({});
  const gainNodes= useRef<Partial<Record<keyof StemUrls, GainNode>>>({});
  const startedAt= useRef(0); // ctx.currentTime snapshot at play
  const pausedAt = useRef(0); // song-position at last pause
  const rafRef   = useRef(0);

  const [trackStates, setTrackStates] = useState<Record<keyof StemUrls, TrackState>>({
    vocals: { ...DEFAULT_TRACK },
    drums:  { ...DEFAULT_TRACK },
    bass:   { ...DEFAULT_TRACK },
    other:  { ...DEFAULT_TRACK },
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState<Partial<Record<keyof StemUrls, boolean>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // Stable refs for the RAF callback
  const trackStatesRef = useRef(trackStates);
  useEffect(() => { trackStatesRef.current = trackStates; }, [trackStates]);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // ── Expose handle ──────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getCurrentTime: () => {
      if (!ctxRef.current || !isPlayingRef.current) return pausedAt.current;
      return pausedAt.current + (ctxRef.current.currentTime - startedAt.current);
    },
  }));

  function getCtx(): AudioContext {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }

  // ── Load stems into AudioContext buffers ───────────────────────────────
  useEffect(() => {
    const urls = TRACKS
      .map((t) => ({ key: t.key, url: stems[t.key] }))
      .filter((t): t is { key: keyof StemUrls; url: string } => !!t.url);
    if (!urls.length) return;

    setLoadError(null);
    let cancelled = false;

    (async () => {
      const ctx = getCtx();
      await Promise.all(
        urls.map(async ({ key, url }) => {
          try {
            const res = await fetch(stemUrl(url));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ab = await res.arrayBuffer();
            if (cancelled) return;
            const buf = await ctx.decodeAudioData(ab);
            if (cancelled) return;
            buffers.current[key] = buf;
            setLoaded((p) => ({ ...p, [key]: true }));
            setDuration((d) => (buf.duration > d ? buf.duration : d));
          } catch (e) {
            if (!cancelled) setLoadError(`Could not load ${key} stem`);
            console.error(`stem load [${key}]:`, e);
          }
        })
      );
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stems]);

  // ── Gain helpers ───────────────────────────────────────────────────────
  function effectiveGain(
    key: keyof StemUrls,
    states: Record<keyof StemUrls, TrackState>
  ): number {
    const anySolo = TRACKS.some((t) => states[t.key].solo);
    const ts = states[key];
    if (ts.muted) return 0;
    if (anySolo && !ts.solo) return 0;
    return ts.volume;
  }

  function applyGains(states: Record<keyof StemUrls, TrackState>) {
    TRACKS.forEach(({ key }) => {
      const gn = gainNodes.current[key];
      if (gn) gn.gain.value = effectiveGain(key, states);
    });
  }

  // ── Playback ───────────────────────────────────────────────────────────
  function startFrom(offset: number) {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();

    TRACKS.forEach(({ key }) => {
      const buf = buffers.current[key];
      if (!buf) return;
      const gain = ctx.createGain();
      gain.gain.value = effectiveGain(key, trackStatesRef.current);
      gain.connect(ctx.destination);
      gainNodes.current[key] = gain;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start(0, Math.max(0, offset));
      sources.current[key] = src;
    });

    startedAt.current = ctx.currentTime;
    pausedAt.current = offset;
    setIsPlaying(true);

    const tick = () => {
      if (!isPlayingRef.current) return;
      const t = pausedAt.current + (ctx.currentTime - startedAt.current);
      setCurrentTime(t);
      onTimeUpdate?.(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopAll(savePosition = false) {
    cancelAnimationFrame(rafRef.current);
    if (savePosition && ctxRef.current) {
      pausedAt.current =
        pausedAt.current + (ctxRef.current.currentTime - startedAt.current);
    }
    TRACKS.forEach(({ key }) => {
      try { sources.current[key]?.stop(); } catch { /* already stopped */ }
      sources.current[key] = undefined;
      gainNodes.current[key] = undefined;
    });
    setIsPlaying(false);
  }

  function togglePlay() {
    if (isPlaying) stopAll(true);
    else startFrom(pausedAt.current);
  }

  function seek(t: number) {
    const was = isPlaying;
    if (was) stopAll(false);
    pausedAt.current = t;
    setCurrentTime(t);
    onTimeUpdate?.(t);
    if (was) startFrom(t);
  }

  // ── Track control handlers ─────────────────────────────────────────────
  function toggleMute(key: keyof StemUrls) {
    setTrackStates((prev) => {
      const next = { ...prev, [key]: { ...prev[key], muted: !prev[key].muted } };
      applyGains(next);
      return next;
    });
  }

  function toggleSolo(key: keyof StemUrls) {
    setTrackStates((prev) => {
      const next = { ...prev, [key]: { ...prev[key], solo: !prev[key].solo } };
      applyGains(next);
      return next;
    });
  }

  function setVolume(key: keyof StemUrls, vol: number) {
    setTrackStates((prev) => {
      const next = { ...prev, [key]: { ...prev[key], volume: vol } };
      applyGains(next);
      return next;
    });
  }

  // ── Derived display values ─────────────────────────────────────────────
  const progress = duration > 0 ? currentTime / duration : 0;
  const anyLoaded = TRACKS.some((t) => loaded[t.key]);
  const hasStem = TRACKS.some((t) => !!stems[t.key]);

  // ── Early returns ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="sticky bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-12 flex items-center gap-3 text-zinc-500 text-sm">
          <span className="animate-spin text-indigo-400 inline-block">⟳</span>
          Separating stems — typically 1–3 minutes…
        </div>
      </div>
    );
  }

  if (!hasStem) return null;

  // ── DAW layout ─────────────────────────────────────────────────────────
  return (
    <div className="sticky bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md shadow-2xl shadow-black/50">
      <div className="max-w-5xl mx-auto">

        {/* ── Track rows ─────────────────────────────────────────────── */}
        <div className="divide-y divide-zinc-800/50">
          {TRACKS.map(({ key, label, color }) => {
            const ts = trackStates[key];
            const url = stems[key];
            const anySolo = TRACKS.some((t) => trackStates[t.key].solo);
            const dimmed = ts.muted || (anySolo && !ts.solo);

            return (
              <div
                key={key}
                className={`flex items-center gap-3 px-4 h-11 transition-opacity duration-150 ${
                  dimmed ? "opacity-35" : "opacity-100"
                }`}
              >
                {/* Track name — fixed 128 px */}
                <div className="w-32 shrink-0 flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  <span className="text-[12px] font-medium text-zinc-300 truncate">
                    {label}
                  </span>
                </div>

                {/* M / S buttons — fixed 56 px */}
                <div className="w-14 shrink-0 flex gap-1 items-center">
                  <button
                    onClick={() => toggleMute(key)}
                    title="Mute"
                    className={`w-[26px] h-[26px] rounded text-[10px] font-bold leading-none transition-colors ${
                      ts.muted
                        ? "bg-red-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    M
                  </button>
                  <button
                    onClick={() => toggleSolo(key)}
                    title="Solo"
                    className={`w-[26px] h-[26px] rounded text-[10px] font-bold leading-none transition-colors ${
                      ts.solo
                        ? "bg-amber-500 text-zinc-900"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    S
                  </button>
                </div>

                {/* Volume — fixed 88 px */}
                <VolumeSlider
                  value={ts.volume}
                  color={color}
                  onChange={(v) => setVolume(key, v)}
                />

                {/* Waveform — flex-1, fixed 40 px tall */}
                <WaveformBar
                  url={url ? stemUrl(url) : undefined}
                  color={color}
                  progress={progress}
                />

                {/* Load status — fixed 56 px, always present to lock layout */}
                <div className="w-14 shrink-0 text-right">
                  {url && (
                    loaded[key]
                      ? <span className="text-[10px] text-green-500">✓ ready</span>
                      : <span className="text-[10px] text-zinc-600 animate-pulse">loading…</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Master transport ────────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-4 h-12 border-t border-zinc-800">
          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            disabled={!anyLoaded}
            title={isPlaying ? "Pause" : "Play"}
            className="
              w-8 h-8 rounded-full shrink-0
              bg-indigo-600 hover:bg-indigo-500 active:scale-95
              disabled:opacity-30 disabled:cursor-not-allowed
              flex items-center justify-center transition-all
            "
          >
            {isPlaying ? (
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-white translate-x-px" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Timestamp */}
          <span className="w-[90px] shrink-0 text-[11px] font-mono text-zinc-400 tabular-nums select-none">
            {fmt(currentTime)} / {fmt(duration)}
          </span>

          {/* Scrubber */}
          <div className="flex-1">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="w-full h-px cursor-pointer"
              style={{
                accentColor: "#6366f1",
                background: `linear-gradient(to right, #6366f1 ${progress * 100}%, #3f3f46 ${
                  progress * 100
                }%)`,
              }}
            />
          </div>

          {/* Error */}
          {loadError && (
            <span className="text-[10px] text-red-400 shrink-0 max-w-[160px] truncate">
              {loadError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export default StemPlayer;
