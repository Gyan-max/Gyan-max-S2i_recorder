import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  stream?: MediaStream | null;
  isRecording: boolean;
  duration?: number;
}

export default function AudioVisualizer({ stream, isRecording, duration = 0 }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    if (!isRecording || !stream) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => undefined);
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;
    } catch (e) {
      console.warn('Could not initialize AudioContext visualizer:', e);
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => undefined);
      }
    };
  }, [isRecording, stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barCount = 28;
      const barWidth = 4;
      const gap = (width - barCount * barWidth) / (barCount + 1);

      let dataArray: Uint8Array | null = null;
      if (analyserRef.current) {
        dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        (analyserRef.current.getByteFrequencyData as (array: Uint8Array) => void)(dataArray);
      }

      for (let i = 0; i < barCount; i++) {
        let value = 0;
        if (dataArray && dataArray.length > 0) {
          const index = Math.floor((i / barCount) * dataArray.length);
          value = dataArray[index] / 255;
        } else if (isRecording) {
          // Fallback pulse wave calculation
          const t = Date.now() / 150;
          value = 0.2 + 0.6 * Math.abs(Math.sin(t + i * 0.4));
        } else {
          value = 0.08 + 0.05 * Math.sin(Date.now() / 400 + i);
        }

        const barHeight = Math.max(4, value * height * 0.85);
        const x = gap + i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        // Dynamic color gradient: Rose red when recording loud, Indigo when mild
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        if (isRecording) {
          gradient.addColorStop(0, '#f43f5e'); // Rose 500
          gradient.addColorStop(1, '#e11d48'); // Rose 600
        } else {
          gradient.addColorStop(0, '#818cf8'); // Indigo 400
          gradient.addColorStop(1, '#4f46e5'); // Indigo 600
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 3);
        ctx.fill();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isRecording]);

  const formatSecs = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="audio-visualizer-container">
      <canvas ref={canvasRef} width={280} height={48} className="visualizer-canvas" />
      {isRecording && (
        <div className="live-rec-badge">
          <span className="rec-dot-pulse" />
          <span className="rec-timer-text">{formatSecs(duration)}</span>
        </div>
      )}
    </div>
  );
}
