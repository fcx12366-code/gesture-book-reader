import test from 'node:test';
import assert from 'node:assert/strict';
import { SwipeDetector, isOpenPalm, type Landmark, type GestureDecision, type Sensitivity } from '../src/gesture-detector.ts';

function openHand(rawX = 0.5, y = 0.55): Landmark[] {
  const points: Landmark[] = Array.from({ length: 21 }, () => ({ x: rawX, y, z: 0 }));
  points[0] = { x: rawX, y: y + 0.10 };
  points[1] = { x: rawX - 0.055, y: y + 0.07 };
  points[2] = { x: rawX - 0.085, y: y + 0.045 };
  points[3] = { x: rawX - 0.105, y: y + 0.025 };
  points[4] = { x: rawX - 0.12, y: y + 0.005 };
  for (const [offset, mcp] of [[-0.055, 5], [-0.017, 9], [0.022, 13], [0.055, 17]]) {
    for (const [step, dy] of [0, -0.05, -0.08, -0.115].entries()) points[mcp + step] = { x: rawX + offset, y: y + dy };
  }
  return points;
}
function fist(rawX = 0.5): Landmark[] {
  const points = openHand(rawX);
  for (const mcp of [5, 9, 13, 17]) {
    points[mcp + 2] = { x: points[mcp].x, y: points[mcp].y + 0.005 };
    points[mcp + 3] = { x: points[mcp].x, y: points[mcp].y + 0.035 };
  }
  return points;
}
class Simulation {
  detector: SwipeDetector;
  time = 0;
  flips: string[] = [];
  decisions: GestureDecision[] = [];
  constructor(sensitivity: Sensitivity = 'medium') { this.detector = new SwipeDetector(sensitivity); }
  sample(x: number | null, options: { confidence?: number; hand?: Landmark[]; dt?: number; y?: number } = {}): GestureDecision {
    this.time += options.dt ?? 80;
    const decision = this.detector.update({ time: this.time,
      landmarks: x === null ? null : options.hand ?? openHand(x, options.y), confidence: options.confidence ?? 0.97 });
    if (decision.direction) this.flips.push(decision.direction);
    this.decisions.push(decision); return decision;
  }
  hold(x = 0.5, frames = 8): GestureDecision {
    let result: GestureDecision = { phase: 'searching' };
    for (let i = 0; i < frames; i++) result = this.sample(x);
    return result;
  }
  swipe(from: number, to: number, frames = 6): void {
    for (let i = 1; i <= frames; i++) this.sample(from + (to - from) * i / frames);
  }
}

test('open palm uses finger geometry and tolerates rotated hands', () => {
  assert.equal(isOpenPalm(openHand()), true);
  assert.equal(isOpenPalm(fist()), false);
  const rotated = openHand().map(p => ({ x: 0.5 - (p.y - 0.55), y: 0.55 + (p.x - 0.5) }));
  assert.equal(isOpenPalm(rotated), true);
  assert.equal(isOpenPalm(openHand().slice(0, 20)), false);
  const invalid = openHand(); invalid[8].x = NaN;
  assert.equal(isOpenPalm(invalid), false);
});
test('mirrored visible left swipe advances, visible right swipe goes back', () => {
  const left = new Simulation(); assert.equal(left.hold().phase, 'ready'); left.swipe(0.5, 0.8);
  assert.deepEqual(left.flips, ['next']);
  const right = new Simulation(); right.hold(); right.swipe(0.5, 0.2);
  assert.deepEqual(right.flips, ['prev']);
});
test('a moving hand must first stabilize, with no immediate accidental flip', () => {
  const sim = new Simulation(); sim.swipe(0.2, 0.8, 9);
  assert.deepEqual(sim.flips, []);
});
test('single-frame displacement is rejected and requires a fresh stable hold', () => {
  const sim = new Simulation(); sim.hold(); sim.sample(0.8); sim.sample(0.5);
  assert.deepEqual(sim.flips, []);
  assert.equal(sim.decisions.at(-1)?.phase, 'searching');
});
test('stationary palm and small camera noise never flip', () => {
  const sim = new Simulation(); sim.hold();
  const jitter = [0, 0.012, -0.008, 0.009, -0.011, 0.004];
  for (let i = 0; i < 240; i++) sim.sample(0.5 + jitter[i % jitter.length]);
  assert.deepEqual(sim.flips, []);
});
test('low-confidence hand and closed fist cannot prime or trigger a swipe', () => {
  const low = new Simulation(); low.hold();
  for (let i = 0; i < 8; i++) low.sample(0.5 + i * 0.04, { confidence: 0.45 });
  assert.deepEqual(low.flips, []);
  const closed = new Simulation(); closed.hold();
  for (let i = 0; i < 8; i++) closed.sample(0.5 + i * 0.04, { hand: fist(0.5 + i * 0.04) });
  assert.deepEqual(closed.flips, []);
});
test('diagonal movement and inconsistent direction are rejected', () => {
  const diagonal = new Simulation(); diagonal.hold();
  for (let i = 1; i <= 6; i++) diagonal.sample(0.5 + i * 0.04, { y: 0.55 + i * 0.045 });
  assert.deepEqual(diagonal.flips, []);
  const zigzag = new Simulation(); zigzag.hold();
  for (const x of [0.57, 0.51, 0.61, 0.56, 0.66, 0.60, 0.71]) zigzag.sample(x);
  assert.deepEqual(zigzag.flips, []);
});
test('one swipe triggers once; cooldown and continuing motion cannot rearm it', () => {
  const sim = new Simulation(); sim.hold(); sim.swipe(0.5, 0.8);
  assert.deepEqual(sim.flips, ['next']);
  for (let i = 0; i < 45; i++) sim.sample(0.5 + 0.15 * Math.sin(i * 0.65));
  assert.deepEqual(sim.flips, ['next']);
  sim.hold(0.5, 9); sim.swipe(0.5, 0.2);
  assert.deepEqual(sim.flips, ['next', 'prev']);
});
test('hand loss does not reset cooldown or rearm without a stable hold', () => {
  const sim = new Simulation(); sim.hold(); sim.swipe(0.5, 0.8);
  for (let i = 0; i < 20; i++) sim.sample(null);
  sim.swipe(0.8, 0.2);
  assert.deepEqual(sim.flips, ['next']);
  sim.hold(0.5); sim.swipe(0.5, 0.8);
  assert.deepEqual(sim.flips, ['next', 'next']);
});
test('a missing frame clears accumulated movement, never joins disconnected hands', () => {
  const sim = new Simulation(); sim.hold(); sim.swipe(0.5, 0.6, 3);
  sim.sample(null); sim.swipe(0.6, 0.8, 4);
  assert.deepEqual(sim.flips, []);
});
test('long inference gaps and non-monotonic timestamps do not produce flips', () => {
  const sim = new Simulation(); sim.hold(); sim.sample(0.55); sim.sample(0.65, { dt: 700 }); sim.swipe(0.65, 0.8, 4);
  assert.deepEqual(sim.flips, []);
  const result = sim.detector.update({ time: 1, landmarks: openHand(0.1), confidence: 1 });
  assert.equal(result.direction, undefined);
});
test('sensitivity changes required travel and resets previously accumulated motion', () => {
  const high = new Simulation('high'); high.hold(); high.swipe(0.5, 0.67);
  assert.deepEqual(high.flips, ['next']);
  const low = new Simulation('low'); low.hold(); low.swipe(0.5, 0.67);
  assert.deepEqual(low.flips, []);
  const longer = new Simulation('low'); longer.hold(); longer.swipe(0.5, 0.82, 7);
  assert.deepEqual(longer.flips, ['next']);
  const changed = new Simulation(); changed.hold(); changed.sample(0.57);
  changed.detector.setSensitivity('high'); changed.swipe(0.57, 0.8);
  assert.deepEqual(changed.flips, []);
});
test('explicit reset requires a fresh stable hold', () => {
  const sim = new Simulation(); sim.hold(); sim.detector.reset(); sim.swipe(0.5, 0.8);
  assert.deepEqual(sim.flips, []);
});
