import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as math from '../dist/js/math.js';

const {
  GRID_RADIUS, MIN_FREQ_HZ, FREQ_RATIO, REST_HEIGHT, HEIGHT_SCALE, BAND_COLORS, FACE_NORMALS,
  clamp, generateRods, radiusToFrequency, frequencyToBin, radiusToBin, binToFrequency, formatTime,
  rotatePoint, visibleFaces, depthOrder, makeProjection, project, mixColor, rgbString,
  bandColorAt, bandIndexAt, restColor, shapeAmplitude, idleAmplitude, targetHeight,
  smoothingBlend, levelToDb, softLimit, frequencyToRadius, bandIndexOfFrequency, formatFrequency,
  heightCeiling, limitHeight, HEIGHT_KNEE_RATIO, HEIGHT_TOP_MARGIN,
} = math;

const SAMPLE_RATES = [44100, 48000, 96000];
const FFT_SIZES = [1024, 2048, 4096];
const closeTo = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not within ${eps} of ${expected}`);

test('clamp returns the value inside the range and snaps to the edges outside it', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
});

test('generateRods produces exactly 709 rods inside the radius', () => {
  const rods = generateRods();
  assert.equal(rods.length, 709);
  assert.ok(rods.every((rod) => rod.r <= GRID_RADIUS));
  assert.ok(rods.every((rod) => Math.hypot(rod.x, rod.z) === rod.r));
});

test('generateRods gives unique grid cells and seeds in [0, 1]', () => {
  const rods = generateRods();
  assert.equal(new Set(rods.map((rod) => `${rod.x},${rod.z}`)).size, rods.length);
  assert.ok(rods.every((rod) => rod.seed >= 0 && rod.seed <= 1));
});

test('generateRods is deterministic', () => {
  assert.deepEqual(generateRods(), generateRods());
});

test('radiusToFrequency runs from the minimum at the centre to min * ratio at the rim', () => {
  closeTo(radiusToFrequency(0), MIN_FREQ_HZ);
  closeTo(radiusToFrequency(GRID_RADIUS), MIN_FREQ_HZ * FREQ_RATIO, 1e-6);
});

test('radiusToFrequency is strictly increasing with radius', () => {
  for (let r = 1; r <= GRID_RADIUS; r++) {
    assert.ok(radiusToFrequency(r) > radiusToFrequency(r - 1));
  }
});

test('frequencyToBin converts hertz using sample rate and fft size', () => {
  // 48 kHz / 2048 -> 23.4375 Hz per bin; 468.75 Hz is exactly bin 20.
  assert.equal(frequencyToBin(468.75, 48000, 2048), 20);
});

test('frequencyToBin clamps to [1, binCount - 2] for any fft size', () => {
  for (const fftSize of FFT_SIZES) {
    assert.equal(frequencyToBin(0, 48000, fftSize), 1);
    assert.equal(frequencyToBin(1e9, 48000, fftSize), fftSize / 2 - 2);
  }
});

test('radiusToBin is monotonic non-decreasing and stays within [1, bins - 2]', () => {
  for (const sampleRate of SAMPLE_RATES) {
    for (const fftSize of FFT_SIZES) {
      let previous = 0;
      for (let r = 0; r <= GRID_RADIUS; r += 0.5) {
        const bin = radiusToBin(r, sampleRate, fftSize);
        assert.ok(bin >= previous, `bin dropped at r=${r}`);
        assert.ok(bin >= 1 && bin <= fftSize / 2 - 2);
        previous = bin;
      }
    }
  }
});

test('radiusToBin does not assume a 2048-point fft', () => {
  const small = radiusToBin(GRID_RADIUS, 48000, 1024);
  const large = radiusToBin(GRID_RADIUS, 48000, 4096);
  assert.ok(large > small);
});

test('binToFrequency inverts frequencyToBin within half a bin', () => {
  const binWidth = 48000 / 2048;
  const bin = frequencyToBin(1000, 48000, 2048);
  assert.ok(Math.abs(binToFrequency(bin, 48000, 2048) - 1000) <= binWidth / 2);
  assert.equal(binToFrequency(0, 48000, 2048), 0);
});

test('formatTime formats 0, 59, 61 and 3600 seconds', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(59), '00:59');
  assert.equal(formatTime(61), '01:01');
  assert.equal(formatTime(3600), '60:00');
});

test('formatTime floors fractions and tolerates invalid input', () => {
  assert.equal(formatTime(59.9), '00:59');
  assert.equal(formatTime(-5), '00:00');
  assert.equal(formatTime(Number.NaN), '00:00');
  assert.equal(formatTime(Infinity), '00:00');
});

test('rotatePoint leaves the point unchanged at angle 0 and quarter-turns correctly', () => {
  assert.deepEqual(rotatePoint(3, 4, 0), { rx: 3, rz: 4 });
  const quarter = rotatePoint(1, 0, Math.PI / 2);
  closeTo(quarter.rx, 0);
  closeTo(quarter.rz, 1);
});

test('visibleFaces at angle 0 shows only the face pointing toward +z', () => {
  assert.deepEqual(visibleFaces(0), [2]);
});

test('visibleFaces at pi/4 shows the +x and +z faces', () => {
  assert.deepEqual(visibleFaces(Math.PI / 4), [1, 2]);
});

test('visibleFaces always returns one or two faces, each satisfying the visibility rule', () => {
  for (let angle = -7; angle <= 7; angle += 0.0137) {
    const faces = visibleFaces(angle);
    assert.ok(faces.length >= 1 && faces.length <= 2, `angle ${angle}: ${faces.length} faces`);
    for (const face of faces) {
      const [nx, nz] = FACE_NORMALS[face];
      assert.ok(nx * Math.sin(angle) + nz * Math.cos(angle) > 0);
    }
  }
});

test('visibleFaces at the default view angle shows the +z and -x faces', () => {
  assert.deepEqual(visibleFaces(-0.32), [2, 3]);
});

test('depthOrder is a permutation sorted by ascending rotated depth', () => {
  const rods = generateRods();
  const angle = -0.32;
  const order = depthOrder(rods, angle);
  assert.equal(order.length, rods.length);
  assert.equal(new Set(order).size, rods.length);
  const depth = (i) => rotatePoint(rods[i].x, rods[i].z, angle).rz;
  for (let n = 1; n < order.length; n++) {
    assert.ok(depth(order[n]) >= depth(order[n - 1]));
  }
});

test('depthOrder does not mutate its input', () => {
  const rods = generateRods();
  const snapshot = structuredClone(rods);
  depthOrder(rods, 1.1);
  assert.deepEqual(rods, snapshot);
});

test('makeProjection centres horizontally and scales to the limiting dimension', () => {
  const wide = makeProjection(1000, 370, { angle: 0, tilt: 0.5, zoom: 1 });
  assert.equal(wide.cx, 500);
  assert.equal(wide.scale, 10); // height-limited: 370 / 37
  const tall = makeProjection(450, 2000, { angle: 0, tilt: 0.5, zoom: 2 });
  assert.equal(tall.scale, 20); // width-limited: 450 / 45 * 2
});

test('project maps the origin to the screen centre and lifts by height', () => {
  const view = makeProjection(900, 740, { angle: 0.7, tilt: 0.6, zoom: 1 });
  const [x, y] = project(view, 0, 0);
  assert.equal(x, view.cx);
  assert.equal(y, view.cy);
  const [, lifted] = project(view, 0, 0, 2);
  closeTo(lifted, y - 2 * view.scale);
});

test('project at angle 0 sends +z downward and +x to the right', () => {
  const view = makeProjection(900, 740, { angle: 0, tilt: 0.5, zoom: 1 });
  const [x0, y0] = project(view, 0, 0);
  const [x1] = project(view, 1, 0);
  const [, y2] = project(view, 0, 1);
  assert.ok(x1 > x0);
  assert.ok(y2 > y0);
});

test('mixColor interpolates, clamps t and does not mutate its inputs', () => {
  const a = [0, 100, 200];
  const b = [100, 200, 0];
  assert.deepEqual(mixColor(a, b, 0), [0, 100, 200]);
  assert.deepEqual(mixColor(a, b, 1), [100, 200, 0]);
  assert.deepEqual(mixColor(a, b, 0.5), [50, 150, 100]);
  assert.deepEqual(mixColor(a, b, 5), [100, 200, 0]);
  assert.deepEqual(mixColor(a, b, -5), [0, 100, 200]);
  assert.deepEqual(a, [0, 100, 200]);
});

test('rgbString rounds channels', () => {
  assert.equal(rgbString([0.4, 127.6, 254.6]), 'rgb(0,128,255)');
});

test('bandColorAt returns the legend colours at centre, middle and edge', () => {
  assert.deepEqual(bandColorAt(0), [...BAND_COLORS.low]);
  assert.deepEqual(bandColorAt(0.5), [...BAND_COLORS.mid]);
  assert.deepEqual(bandColorAt(1), [...BAND_COLORS.high]);
  assert.deepEqual(bandColorAt(-3), [...BAND_COLORS.low]);
  assert.deepEqual(bandColorAt(9), [...BAND_COLORS.high]);
});

test('bandIndexAt splits the radius into low, mid and high thirds', () => {
  assert.equal(bandIndexAt(0), 0);
  assert.equal(bandIndexAt(0.5), 1);
  assert.equal(bandIndexAt(1), 2);
});

test('restColor maps rare seeds to rust and sage and the rest to a seed-varied olive', () => {
  assert.deepEqual(restColor(0.95), [143, 109, 81]);
  assert.deepEqual(restColor(0.9), [97, 118, 104]);
  assert.deepEqual(restColor(0), [139, 148, 119]);
  const [r, g, b] = restColor(0.5);
  closeTo(r, 153.5);
  closeTo(g, 159);
  closeTo(b, 129.5);
});

test('shapeAmplitude is zero for silence and follows the raw curve, scaled linearly by sensitivity', () => {
  const silent = new Uint8Array(16);
  assert.equal(shapeAmplitude(silent, 5, 2), 0);
  const loud = new Uint8Array(16).fill(255);
  closeTo(shapeAmplitude(loud, 5, 1), 1);
  closeTo(shapeAmplitude(loud, 5, 3), 3); // unbounded: height limiting happens later, in world units
  const quiet = new Uint8Array(16).fill(128);
  closeTo(shapeAmplitude(quiet, 5, 1.2), Math.pow(128 / 255, 1.7) * 1.2);
});

test('shapeAmplitude averages the bin with its two neighbours', () => {
  const lone = new Uint8Array(16);
  lone[5] = 255;
  closeTo(shapeAmplitude(lone, 5, 1), Math.pow(1 / 3, 1.7));
  const trio = new Uint8Array(16);
  trio.fill(255, 4, 7);
  closeTo(shapeAmplitude(trio, 5, 1), 1);
});

const KNEE = 0.6;
const CEILING = 1.15;

test('softLimit is the identity at and below the knee', () => {
  for (const x of [0, 0.1, 0.3, KNEE]) assert.equal(softLimit(x, KNEE, CEILING), x);
});

test('softLimit is continuous at the knee with slope 1 on both sides', () => {
  const h = 1e-6;
  closeTo(softLimit(KNEE + h, KNEE, CEILING), KNEE + h, 1e-9);
  const slopeBelow = (softLimit(KNEE, KNEE, CEILING) - softLimit(KNEE - h, KNEE, CEILING)) / h;
  const slopeAbove = (softLimit(KNEE + h, KNEE, CEILING) - softLimit(KNEE, KNEE, CEILING)) / h;
  closeTo(slopeBelow, 1, 1e-6);
  closeTo(slopeAbove, 1, 1e-5);
});

test('softLimit is strictly increasing and compresses above the knee', () => {
  let previous = softLimit(0, KNEE, CEILING);
  for (let x = 0.01; x <= 10; x += 0.01) {
    const y = softLimit(x, KNEE, CEILING);
    assert.ok(y > previous, `not increasing at ${x}`);
    if (x > KNEE + 0.01) assert.ok(y < x, `not compressed at ${x}`);
    previous = y;
  }
});

test('softLimit never exceeds the ceiling, even for huge input', () => {
  for (const x of [1, 1.15, 3, 10, 1e3, 1e9, Infinity]) {
    assert.ok(softLimit(x, KNEE, CEILING) <= CEILING, `x=${x}`);
  }
  closeTo(softLimit(1e9, KNEE, CEILING), CEILING);
});

test('softLimit with an infinite knee and ceiling is the identity', () => {
  assert.equal(softLimit(123, Infinity, Infinity), 123);
});

test('heightCeiling puts the centre rod top at the top margin of the stage at zoom 1', () => {
  // 1090 x 828 stage: height-limited, scale = 828 / 37.
  const ceiling = heightCeiling(1090, 828, 1);
  const { scale } = makeProjection(1090, 828, { angle: 0, tilt: 0.58, zoom: 1 });
  closeTo(ceiling * scale, 828 * (0.55 - HEIGHT_TOP_MARGIN), 1e-9);
  closeTo(ceiling, 11.1, 0.01);
});

test('heightCeiling shrinks as the view zooms in and is infinite for an unmeasured stage', () => {
  assert.ok(heightCeiling(1090, 828, 1.5) < heightCeiling(1090, 828, 1));
  assert.ok(heightCeiling(1090, 828, 0.65) > heightCeiling(1090, 828, 1));
  assert.equal(heightCeiling(0, 0, 1), Infinity);
});

test('limitHeight leaves heights up to the knee share of the ceiling untouched', () => {
  const ceiling = 10;
  assert.equal(limitHeight(0, ceiling), 0);
  assert.equal(limitHeight(ceiling * HEIGHT_KNEE_RATIO, ceiling), ceiling * HEIGHT_KNEE_RATIO);
});

test('limitHeight is monotonic, below the identity above the knee, and bounded by the ceiling', () => {
  const ceiling = 10;
  let previous = -1;
  for (let h = 0; h <= 200; h += 0.5) {
    const y = limitHeight(h, ceiling);
    assert.ok(y > previous);
    assert.ok(y <= ceiling);
    if (h > ceiling * HEIGHT_KNEE_RATIO + 0.5) assert.ok(y < h);
    previous = y;
  }
});

test('a larger height factor keeps making rods taller up to the ceiling, with no dead zone', () => {
  const ceiling = heightCeiling(1090, 828, 1);
  const amplitude = 0.8;
  let previous = targetHeight(amplitude, 0.5, ceiling);
  for (let factor = 0.6; factor <= 2.5001; factor += 0.1) {
    const h = targetHeight(amplitude, factor, ceiling);
    assert.ok(h > previous + 0.05, `factor ${factor} gained too little`);
    assert.ok(h <= REST_HEIGHT + ceiling);
    previous = h;
  }
});

test('targetHeight at factor 1 leaves ordinary heights unchanged and sensitivity does not touch the factor', () => {
  const ceiling = heightCeiling(1090, 828, 1);
  closeTo(targetHeight(0.8, 1, ceiling), REST_HEIGHT + 0.8 * HEIGHT_SCALE);
  closeTo(targetHeight(0.4, 2, ceiling), targetHeight(0.8, 1, ceiling));
});

test('frequencyToRadius inverts radiusToFrequency', () => {
  for (let r = 0; r <= GRID_RADIUS; r += 1.5) closeTo(frequencyToRadius(radiusToFrequency(r)), r, 1e-9);
});

test('bandIndexOfFrequency uses the same thirds of the radius as the renderer', () => {
  for (let r = 0; r <= GRID_RADIUS; r += 0.25) {
    assert.equal(bandIndexOfFrequency(radiusToFrequency(r)), bandIndexAt(r / GRID_RADIUS), `r=${r}`);
  }
});

test('bandIndexOfFrequency names the expected bands and clamps out-of-range input', () => {
  assert.equal(bandIndexOfFrequency(110), 0);
  assert.equal(bandIndexOfFrequency(1000), 1);
  assert.equal(bandIndexOfFrequency(8000), 2);
  assert.equal(bandIndexOfFrequency(1), 0);
  assert.equal(bandIndexOfFrequency(0), 0);
  assert.equal(bandIndexOfFrequency(96000), 2);
});

test('formatFrequency uses Hz below 1 kHz and kHz with one decimal at or above it', () => {
  assert.equal(formatFrequency(45), '45 Hz');
  assert.equal(formatFrequency(431.6), '432 Hz');
  assert.equal(formatFrequency(1000), '1 kHz');
  assert.equal(formatFrequency(14400), '14.4 kHz');
  assert.equal(formatFrequency(MIN_FREQ_HZ * FREQ_RATIO), '14.4 kHz');
});

test('idleAmplitude stays within the breathing band 0.10 to 0.30', () => {
  for (let t = 0; t < 20000; t += 137) {
    const amp = idleAmplitude(7, -3, t);
    assert.ok(amp >= 0.1 - 1e-12 && amp <= 0.3 + 1e-12);
  }
});

test('idleAmplitude varies with time and radius', () => {
  assert.notEqual(idleAmplitude(5, 0, 0), idleAmplitude(5, 0, 2000));
  assert.notEqual(idleAmplitude(2, 0, 0), idleAmplitude(9, 0, 0));
});

test('targetHeight is the rest height at silence and grows linearly', () => {
  assert.equal(targetHeight(0), REST_HEIGHT);
  closeTo(targetHeight(1), REST_HEIGHT + HEIGHT_SCALE);
});

test('smoothingBlend shrinks as smoothing grows and approaches 1 with larger dt', () => {
  assert.ok(smoothingBlend(0, 1) > smoothingBlend(0.75, 1));
  assert.ok(smoothingBlend(0.75, 3) > smoothingBlend(0.75, 1));
  assert.equal(smoothingBlend(0.5, 0), 0);
  closeTo(smoothingBlend(0, 1), 0.55);
});

test('levelToDb converts RMS to whole dB with a -60 dB floor', () => {
  assert.equal(levelToDb(1), 0);
  assert.equal(levelToDb(0.1), -20);
  assert.equal(levelToDb(0), -60);
  assert.equal(levelToDb(0.0001), -60);
});

test('every function exported by math.js is covered by this suite', () => {
  const exported = Object.entries(math)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name);
  const covered = [
    'clamp', 'generateRods', 'radiusToFrequency', 'frequencyToBin', 'radiusToBin', 'binToFrequency',
    'formatTime', 'rotatePoint', 'visibleFaces', 'depthOrder', 'makeProjection', 'project', 'mixColor',
    'rgbString', 'bandColorAt', 'bandIndexAt', 'restColor', 'shapeAmplitude', 'idleAmplitude',
    'targetHeight', 'smoothingBlend', 'levelToDb', 'softLimit', 'heightCeiling', 'limitHeight', 'frequencyToRadius',
    'bandIndexOfFrequency', 'formatFrequency',
  ];
  assert.deepEqual([...exported].sort(), [...covered].sort());
});
