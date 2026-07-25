import { forwardRef, useEffect, useRef, useState } from 'react';
import { Play, Pause, Gauge } from 'lucide-react';

interface AudioPlayerProps {
  src: string;
  /** Called whenever the browser reports a seek attempt on the underlying <audio> element.
   *  Return a number to force-correct currentTime (used to enforce listen-before-keep). */
  onSeekAttempt?: (attemptedTime: number) => number | void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const AudioPlayer = forwardRef<HTMLAudioElement, AudioPlayerProps>(function AudioPlayer(
  { src, onSeekAttempt, onPlay, onPause, onEnded, onTimeUpdate },
  forwardedRef
) {
  const internalRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [src]);

  const attachRef = (node: HTMLAudioElement | null) => {
    internalRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLAudioElement | null>).current = node;
  };

  const togglePlay = () => {
    const el = internalRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  };

  const toggleSpeed = () => {
    const nextRate = playbackRate === 1.0 ? 1.25 : playbackRate === 1.25 ? 1.5 : 1.0;
    setPlaybackRate(nextRate);
    if (internalRef.current) {
      internalRef.current.playbackRate = nextRate;
    }
  };

  const handleSeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const el = internalRef.current;
    if (!el) return;
    el.currentTime = parseFloat(event.target.value);
  };

  const safeDuration = Number.isFinite(duration) ? duration : 0;
  const progressPct = safeDuration > 0 ? Math.min(100, (currentTime / safeDuration) * 100) : 0;

  return (
    <div className="audio-player glass-audio-player">
      <audio
        ref={attachRef}
        src={src}
        preload="metadata"
        onPlay={() => { setIsPlaying(true); onPlay?.(); }}
        onPause={() => { setIsPlaying(false); onPause?.(); }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
          event.currentTarget.playbackRate = playbackRate;
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
          onTimeUpdate?.(event.currentTarget.currentTime);
        }}
        onSeeking={(event) => {
          const corrected = onSeekAttempt?.(event.currentTarget.currentTime);
          if (typeof corrected === 'number') {
            event.currentTarget.currentTime = corrected;
          }
        }}
        onEnded={() => { setIsPlaying(false); onEnded?.(); }}
      />

      <div className="audio-player-controls">
        <button
          type="button"
          className="audio-play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
        </button>

        <input
          type="range"
          className="audio-seek"
          min={0}
          max={safeDuration}
          step={0.01}
          value={Math.min(currentTime, safeDuration)}
          onChange={handleSeekChange}
          style={{ '--audio-progress': `${progressPct}%` } as unknown as React.CSSProperties}
          aria-label="Seek within recording"
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        />

        <div className="audio-player-right-group">
          <button 
            type="button" 
            className="speed-toggle-btn"
            onClick={toggleSpeed}
            title="Toggle playback speed"
          >
            <Gauge size={14} />
            <span>{playbackRate}x</span>
          </button>

          <span className="audio-time" aria-hidden="true">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
});

export default AudioPlayer;
