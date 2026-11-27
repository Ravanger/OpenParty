import { createSubscriber } from "svelte/reactivity";

/** How often the tween invalidates its readers, in ms: roughly one animation frame. */
const TICK_MS = 16;

/** A point in the game's own coordinate space. @experimental Real-time client API; may change before 1.0. */
export interface TweenPoint {
  /** Horizontal coordinate. */
  x: number;
  /** Vertical coordinate. */
  y: number;
}

/** Options for {@link Tween}. @experimental Real-time client API; may change before 1.0. */
export interface TweenOptions {
  /** Whether the user asked for reduced motion; when true the tween jumps straight to the end. Default `() => false`. */
  reducedMotion?: () => boolean;
}

/**
 * A movement the server wrote once: where it starts, where it ends (or the waypoints after the
 * start), when it started on the server clock and how long it runs. Pass either `to` for a
 * straight line or `path` for a route; a repeated consecutive point is dropped.
 *
 * @experimental Real-time client API; may change before 1.0.
 */
export type TweenSpec =
  | { from: TweenPoint; to: TweenPoint; path?: never; startedAt: number; durationMs: number }
  | {
      from: TweenPoint;
      path: readonly TweenPoint[];
      to?: never;
      startedAt: number;
      durationMs: number;
    };

/** One leg of the route, with the cumulative distances at which it starts and ends. */
interface TweenSegment {
  start: TweenPoint;
  end: TweenPoint;
  from: number;
  to: number;
}

/**
 * Interpolates a movement the server wrote once, reading the server clock's `now()` rather than
 * the local clock. Read `position` in a Svelte effect: it invalidates roughly every frame while
 * read and writes nothing to shared state. Before `startedAt` it returns the start, after the
 * duration the end; with reduced motion it jumps straight to the end.
 *
 * @experimental Real-time client API; may change before 1.0.
 */
export class Tween {
  private readonly first: TweenPoint;
  private readonly last: TweenPoint;
  private readonly segments: readonly TweenSegment[];
  private readonly total: number;
  private readonly isReducedMotion: () => boolean;
  private readonly track: () => void;

  constructor(
    private readonly spec: TweenSpec,
    private readonly clock: { now(): number },
    options: TweenOptions = {},
  ) {
    const route = spec.path === undefined ? [spec.to] : spec.path;
    const segments: TweenSegment[] = [];
    let total = 0;
    let previous = spec.from;
    for (const point of route) {
      if (previous.x === point.x && previous.y === point.y) continue;
      const to = total + distance(previous, point);
      segments.push({ start: previous, end: point, from: total, to });
      total = to;
      previous = point;
    }
    this.first = spec.from;
    this.last = previous;
    this.segments = segments;
    this.total = total;
    this.isReducedMotion = options.reducedMotion ?? (() => false);
    this.track = createSubscriber((update) => {
      const interval = setInterval(update, TICK_MS);
      return () => clearInterval(interval);
    });
  }

  /** How far through the movement the clock is, from 0 to 1; 1 under reduced motion or a zero duration. */
  get progress(): number {
    this.track();
    return this.progressAt();
  }

  /** The interpolated position at the clock's current time; a fresh object on every read. */
  get position(): TweenPoint {
    this.track();
    return this.positionAt(this.progressAt());
  }

  private progressAt(): number {
    if (this.isReducedMotion()) return 1;
    if (this.spec.durationMs <= 0) return 1;
    const progress = (this.clock.now() - this.spec.startedAt) / this.spec.durationMs;
    return Math.min(1, Math.max(0, progress));
  }

  private positionAt(progress: number): TweenPoint {
    // Fresh copies: a caller must not be able to mutate the tween's start or end points.
    if (progress <= 0) return { x: this.first.x, y: this.first.y };
    if (progress >= 1 || this.total <= 0) return { x: this.last.x, y: this.last.y };
    const target = this.total * progress;
    let position = this.last;
    for (const segment of this.segments) {
      if (target > segment.to) continue;
      const t = (target - segment.from) / (segment.to - segment.from);
      position = interpolate(segment.start, segment.end, t);
      break;
    }
    return position;
  }
}

/** The straight-line distance between two points. */
function distance(a: TweenPoint, b: TweenPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point `t` of the way from `a` to `b`. */
function interpolate(a: TweenPoint, b: TweenPoint, t: number): TweenPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
