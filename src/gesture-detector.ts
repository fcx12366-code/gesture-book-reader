export type FlipDirection = 'next' | 'prev';
export type Sensitivity = 'low' | 'medium' | 'high';
export type DetectorPhase = 'searching' | 'ready' | 'cooldown';
export interface Landmark { x: number; y: number; z?: number }
export interface HandSample {
  time: number;
  landmarks: readonly Landmark[] | null;
  /** Handedness score is an additional quality gate; model presence/detection gates run upstream. */
  confidence: number;
}
export interface GestureDecision { phase: DetectorPhase; direction?: FlipDirection }

const SETTINGS = {
  low: { distance: 0.25, minFrames: 5, minDuration: 230, confidence: 0.8, cooldown: 1300 },
  medium: { distance: 0.19, minFrames: 4, minDuration: 180, confidence: 0.75, cooldown: 1100 },
  high: { distance: 0.14, minFrames: 4, minDuration: 160, confidence: 0.7, cooldown: 950 },
} as const;
const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
function straight(a: Landmark, b: Landmark, c: Landmark): boolean {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const denominator = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return denominator > 0.00001 && (ux * vx + uy * vy) / denominator < -0.82;
}

/** Rotation-independent finger extension checks, never just the bounding box. */
export function isOpenPalm(points: readonly Landmark[]): boolean {
  if (points.length !== 21 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const scale = distance(points[0], points[9]);
  if (scale < 0.035 || scale > 0.5) return false;
  for (const [mcp, pip, dip, tip] of [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
    if (!straight(points[mcp], points[pip], points[tip]) || !straight(points[pip], points[dip], points[tip])) return false;
    if (distance(points[tip], points[0]) < distance(points[pip], points[0]) + scale * 0.22) return false;
  }
  // A thumb folded tightly over the palm should not count as a fully open hand.
  return distance(points[4], points[9]) > scale * 0.55;
}

interface Position { x: number; y: number; time: number }
export class SwipeDetector {
  private sensitivity: Sensitivity;
  private armed = false;
  private cooldownUntil = -Infinity;
  private steady: Position | null = null;
  private history: Position[] = [];
  private lastTime = -Infinity;

  constructor(sensitivity: Sensitivity = 'medium') { this.sensitivity = sensitivity; }
  setSensitivity(value: Sensitivity): void { this.sensitivity = value; this.reset(); }
  reset(): void {
    this.armed = false; this.cooldownUntil = -Infinity; this.steady = null;
    this.history = []; this.lastTime = -Infinity;
  }
  update(sample: HandSample): GestureDecision {
    const config = SETTINGS[this.sensitivity];
    const cooling = sample.time < this.cooldownUntil;
    const phase = (): DetectorPhase => cooling ? 'cooldown' : this.armed ? 'ready' : 'searching';
    if (!Number.isFinite(sample.time) || sample.time <= this.lastTime) return { phase: phase() };
    const gap = sample.time - this.lastTime;
    this.lastTime = sample.time;
    const valid = sample.landmarks && sample.confidence >= config.confidence && isOpenPalm(sample.landmarks);
    if (!valid) {
      this.armed = false; this.steady = null; this.history = [];
      return { phase: cooling ? 'cooldown' : 'searching' };
    }
    if (gap > 250) { this.armed = false; this.steady = null; this.history = []; }
    const points = sample.landmarks!;
    const palm = [0, 5, 9, 13, 17].map(i => points[i]);
    // Match the CSS-mirrored camera preview: a visible leftward swipe turns forward.
    const position = { x: 1 - palm.reduce((n, p) => n + p.x, 0) / palm.length,
      y: palm.reduce((n, p) => n + p.y, 0) / palm.length, time: sample.time };
    if (cooling) { this.steady = null; this.history = []; return { phase: 'cooldown' }; }
    if (!this.armed) {
      if (!this.steady || distance(this.steady, position) > 0.025) this.steady = position;
      if (sample.time - this.steady.time >= 400) {
        this.armed = true; this.history = [position]; this.steady = null;
      }
      return { phase: this.armed ? 'ready' : 'searching' };
    }
    const previous = this.history.at(-1);
    if (previous && distance(position, previous) > 0.2) {
      this.armed = false; this.history = []; this.steady = null;
      return { phase: 'searching' };
    }
    this.history.push(position);
    this.history = this.history.filter(p => sample.time - p.time <= 850);
    const first = this.history[0], dx = position.x - first.x, dy = position.y - first.y;
    const duration = position.time - first.time;
    if (this.history.length < config.minFrames || duration < config.minDuration || Math.abs(dx) < config.distance) return { phase: 'ready' };
    let path = 0, agreeing = 0, moving = 0;
    for (let i = 1; i < this.history.length; i++) {
      const delta = this.history[i].x - this.history[i - 1].x;
      path += Math.abs(delta);
      if (Math.abs(delta) > 0.004) { moving++; if (Math.sign(delta) === Math.sign(dx)) agreeing++; }
    }
    if (Math.abs(dy) > 0.12 || Math.abs(dy) > Math.abs(dx) * 0.6 || !moving || agreeing / moving < 0.8 || Math.abs(dx) / path < 0.83) return { phase: 'ready' };
    this.armed = false; this.cooldownUntil = sample.time + config.cooldown;
    this.steady = null; this.history = [];
    return { phase: 'cooldown', direction: dx < 0 ? 'next' : 'prev' };
  }
}
