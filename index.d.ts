import { EventEmitter } from "events";

export interface PlayOptions {
  file: string;
  mode: string;
  debug: boolean;
  width?: number | null;
  height?: number | null;
  speed?: number;
  loop?: boolean;
  startTime?: number;
  endTime?: number | null;
  fps?: number | null;
}

declare class PlayBadAppleOnIt extends EventEmitter {
  constructor(options: PlayOptions);

  readonly file: string;

  mode: string;
  debug: boolean;
  width?: number | null;
  height?: number | null;
  speed: number;
  loop: boolean;
  startTime: number;
  endTime: number | null;
  fps: number | null;

  start(): void;
  pause(): void;
  resume(): void;
  setSpeed(speed: number): void; 
  stop(): void;

  on(event: "frame", listener: (frame: Buffer) => void): this;
  on(event: "end", listener: (code?: number) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "pause" | "resume" | "stop", listener: () => void): this;

  once(event: "frame", listener: (frame: Buffer) => void): this;
  once(event: "end", listener: (code?: number) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
  once(event: "pause" | "resume" | "stop", listener: () => void): this;
}

export = PlayBadAppleOnIt;