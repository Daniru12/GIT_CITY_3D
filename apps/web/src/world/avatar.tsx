import type { MutableRefObject } from 'react';
import * as THREE from 'three';

/**
 * Developer character with a small joint rig (hips, knees, shoulders, elbows, neck, backpack, eyelids)
 * and a procedural animator built on classic animation principles:
 *   anticipation (crouch before jumping, arm raise before a wave), squash & stretch (landing / launch),
 *   ease in / ease out (speed is damped, never snapped), follow-through & overlap (backpack spring, head lags the body),
 *   secondary action (breathing, weight shift, blinking, look-around), arcs (feet and arms swing on pivots),
 *   timing (stride rate follows speed; sprint lengthens the stride and leans the body).
 * Feet rest at y = -0.9 (the capsule collider's bottom).
 */
export interface AvatarRig {
  root: THREE.Group | null;
  body: THREE.Group | null;
  head: THREE.Group | null;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
  foreL: THREE.Group | null;
  foreR: THREE.Group | null;
  legL: THREE.Group | null;
  legR: THREE.Group | null;
  shinL: THREE.Group | null;
  shinR: THREE.Group | null;
  pack: THREE.Group | null;
  eyeL: THREE.Group | null;
  eyeR: THREE.Group | null;
}
export const emptyRig = (): AvatarRig => ({
  root: null,
  body: null,
  head: null,
  armL: null,
  armR: null,
  foreL: null,
  foreR: null,
  legL: null,
  legR: null,
  shinL: null,
  shinR: null,
  pack: null,
  eyeL: null,
  eyeR: null,
});

const SKIN = '#f2c9a0';
const PANTS = '#27325c';

export function Avatar({ rig, accent = '#7c5cff' }: { rig: MutableRefObject<AvatarRig>; accent?: string }) {
  const set = (k: keyof AvatarRig) => (g: THREE.Group | null) => {
    rig.current[k] = g;
  };
  return (
    <group ref={set('root')} position={[0, -0.1, 0]}>
      {/* legs: hip -> thigh -> knee -> shin -> shoe */}
      {(['legL', 'legR'] as const).map((k, i) => (
        <group key={k} ref={set(k)} position={[i === 0 ? -0.19 : 0.19, -0.2, 0]}>
          <mesh position={[0, -0.15, 0]} castShadow>
            <capsuleGeometry args={[0.15, 0.14, 8, 20]} />
            <meshStandardMaterial color={PANTS} roughness={0.7} />
          </mesh>
          <group ref={set(i === 0 ? 'shinL' : 'shinR')} position={[0, -0.33, 0]}>
            <mesh position={[0, -0.13, 0]} castShadow>
              <capsuleGeometry args={[0.13, 0.16, 8, 20]} />
              <meshStandardMaterial color={PANTS} roughness={0.7} />
            </mesh>
            <mesh position={[0, -0.27, 0.06]} scale={[1, 0.62, 1.55]} castShadow>
              <sphereGeometry args={[0.17, 24, 16]} />
              <meshStandardMaterial color="#f4f4f2" roughness={0.45} />
            </mesh>
          </group>
        </group>
      ))}

      {/* upper body (pivot at the hips so leaning looks right) */}
      <group ref={set('body')}>
        <mesh position={[0, 0.2, 0]} scale={[1.08, 1, 0.78]} castShadow>
          <capsuleGeometry args={[0.34, 0.34, 10, 28]} />
          <meshStandardMaterial color={accent} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.0, 0.25]} scale={[1, 0.55, 0.4]}>
          <capsuleGeometry args={[0.2, 0.14, 6, 16]} />
          <meshStandardMaterial color={accent} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.66, -0.02]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.2, 0.07, 12, 32]} />
          <meshStandardMaterial color={accent} roughness={0.6} />
        </mesh>

        {/* head (pivot at the neck) */}
        <group ref={set('head')} position={[0, 0.7, 0]}>
          <mesh position={[0, 0.28, 0]} castShadow>
            <sphereGeometry args={[0.3, 40, 28]} />
            <meshStandardMaterial color={SKIN} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.32, -0.03]} rotation-x={-0.12} castShadow>
            <sphereGeometry args={[0.32, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
            <meshStandardMaterial color="#2a1f1a" roughness={0.8} />
          </mesh>
          {([-0.105, 0.105] as const).map((x, i) => (
            <group key={x} ref={set(i === 0 ? 'eyeL' : 'eyeR')} position={[x, 0.3, 0.262]}>
              <mesh>
                <sphereGeometry args={[0.048, 16, 12]} />
                <meshStandardMaterial color="#10131f" roughness={0.2} />
              </mesh>
              <mesh position={[0.014, 0.016, 0.034]}>
                <sphereGeometry args={[0.014, 8, 8]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0.2, 0.275]} rotation-z={Math.PI} rotation-x={-0.1}>
            <torusGeometry args={[0.085, 0.013, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#8c3b3b" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.3, 0]} rotation-y={Math.PI / 2}>
            <torusGeometry args={[0.335, 0.032, 10, 40, Math.PI]} />
            <meshStandardMaterial color="#1b1e2e" roughness={0.4} metalness={0.3} />
          </mesh>
          {([-0.34, 0.34] as const).map((x) => (
            <mesh key={x} position={[x, 0.28, 0]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.1, 0.1, 0.09, 24]} />
              <meshStandardMaterial color={accent} roughness={0.35} metalness={0.2} emissive={accent} emissiveIntensity={0.25} />
            </mesh>
          ))}
        </group>

        {/* backpack: separate pivot so it can lag and overshoot (follow-through) */}
        <group ref={set('pack')} position={[0, 0.5, -0.3]}>
          <mesh position={[0, -0.28, -0.04]} castShadow>
            <capsuleGeometry args={[0.24, 0.3, 8, 16]} />
            <meshStandardMaterial color="#262b42" roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.2, -0.2]}>
            <circleGeometry args={[0.07, 20]} />
            <meshStandardMaterial color="#00d4ff" emissive="#00d4ff" emissiveIntensity={1.2} />
          </mesh>
        </group>

        {/* arms: shoulder -> upper arm -> elbow -> forearm -> hand */}
        {(['armL', 'armR'] as const).map((k, i) => (
          <group key={k} ref={set(k)} position={[i === 0 ? -0.47 : 0.47, 0.46, 0]}>
            <mesh position={[0, -0.18, 0]} castShadow>
              <capsuleGeometry args={[0.1, 0.22, 8, 16]} />
              <meshStandardMaterial color={accent} roughness={0.6} />
            </mesh>
            <group ref={set(i === 0 ? 'foreL' : 'foreR')} position={[0, -0.36, 0]}>
              <mesh position={[0, -0.12, 0]} castShadow>
                <capsuleGeometry args={[0.09, 0.14, 8, 16]} />
                <meshStandardMaterial color={accent} roughness={0.6} />
              </mesh>
              <mesh position={[0, -0.28, 0]}>
                <sphereGeometry args={[0.095, 20, 14]} />
                <meshStandardMaterial color={SKIN} roughness={0.55} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------ animator ------------------------------ */
export type Emote = 'none' | 'wave' | 'dance' | 'cheer';

export interface AnimInput {
  /** current horizontal speed the controller wants (m/s). 0 when idle. */
  targetSpeed: number;
  walkSpeed: number;
  sprintSpeed: number;
  grounded: boolean;
  vy: number;
  /** 0..1: crouch before take-off (anticipation) */
  windup: number;
  /** slope of the ground in the direction of travel (rad, + = uphill) */
  slope: number;
  /** desired facing (rad) when moving, otherwise null = keep */
  faceYaw: number | null;
  emote: Emote;
}

export interface AnimState {
  phase: number;
  speed: number;
  yaw: number;
  turnRate: number;
  lean: number;
  roll: number;
  squash: number; // spring value, + stretch / - squash
  squashV: number;
  air: number; // seconds airborne
  wasGrounded: boolean;
  packRot: number;
  packV: number;
  prevSpeed: number;
  blinkAt: number;
  blinkT: number;
  emote: Emote;
  emoteT: number;
  emoteBlend: number;
  clock: number;
  windup: number;
}
export const makeAnimState = (): AnimState => ({
  phase: 0,
  speed: 0,
  yaw: Math.PI,
  turnRate: 0,
  lean: 0,
  roll: 0,
  squash: 0,
  squashV: 0,
  air: 0,
  wasGrounded: true,
  packRot: 0,
  packV: 0,
  prevSpeed: 0,
  blinkAt: 2.5,
  blinkT: -1,
  emote: 'none',
  emoteT: 0,
  emoteBlend: 0,
  clock: 0,
  windup: 0,
});

const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const clamp = THREE.MathUtils.clamp;
/** ease-out with a little overshoot: reads as "snappy but alive" */
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = clamp(x, 0, 1) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function animateAvatar(rig: AvatarRig, s: AnimState, input: AnimInput, dt: number): void {
  const { root, body, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, pack, eyeL, eyeR } = rig;
  if (!root || !body || !head || !armL || !armR || !foreL || !foreR || !legL || !legR || !shinL || !shinR || !pack) return;
  dt = Math.min(dt, 0.05);
  s.clock += dt;
  const amp = reduceMotion ? 0.45 : 1;

  /* ---- facing: ease toward the travel direction (turns are never instant) ---- */
  if (input.faceYaw !== null) {
    const diff = Math.atan2(Math.sin(input.faceYaw - s.yaw), Math.cos(input.faceYaw - s.yaw));
    const step = diff * (1 - Math.exp(-14 * dt));
    s.yaw += step;
    s.turnRate = damp(s.turnRate, step / Math.max(dt, 1e-4), 10, dt);
  } else s.turnRate = damp(s.turnRate, 0, 8, dt);

  /* ---- speed: quick to start, softer to stop (ease-out) ---- */
  const target = input.grounded ? input.targetSpeed : s.speed;
  s.speed = damp(s.speed, target, target > s.speed ? 11 : 7, dt);
  const accel = (s.speed - s.prevSpeed) / Math.max(dt, 1e-4);
  s.prevSpeed = s.speed;
  const moveW = clamp(s.speed / 2.5, 0, 1); // 0 idle .. 1 moving
  const run = clamp((s.speed - input.walkSpeed) / (input.sprintSpeed - input.walkSpeed), 0, 1);

  /* ---- gait phase: stride rate follows speed ---- */
  if (input.grounded) s.phase += dt * s.speed * (1.15 + run * 0.12);
  const p = s.phase;
  const sn = Math.sin(p);
  const cs = Math.cos(p);

  /* ---- airtime, landing squash, launch stretch ---- */
  if (!input.grounded) s.air += dt;
  if (input.grounded && !s.wasGrounded) {
    if (s.air > 0.18) s.squash = -clamp(s.air * 0.45, 0.1, 0.26); // landing impact
    s.air = 0;
  }
  s.wasGrounded = input.grounded;
  s.windup = damp(s.windup, input.windup, input.windup > s.windup ? 22 : 14, dt);
  // damped spring (underdamped => a small rebound after landing)
  const k = 190;
  const c = 17;
  s.squashV += (-k * s.squash - c * s.squashV) * dt;
  s.squash += s.squashV * dt;
  const stretch = !input.grounded ? clamp(Math.abs(input.vy) * 0.012, 0, 0.12) : 0;
  const sy = 1 + (s.squash + stretch) * amp - s.windup * 0.12 * amp;
  const sxz = 1 - (sy - 1) * 0.5;

  /* ---- idle: breathing, weight shift, look around, blink ---- */
  const idleW = (1 - moveW) * (input.grounded ? 1 : 0);
  const breathe = Math.sin(s.clock * 2.1) * 0.012 * idleW;
  const shift = Math.sin(s.clock * 0.7) * 0.025 * idleW;

  /* ---- locomotion pose ---- */
  const stride = (0.5 + run * 0.4) * moveW * amp;
  let thighL = -sn * stride;
  let thighR = sn * stride;
  let kneeL = Math.max(0, cs) * (0.55 + run * 0.7) * moveW * amp;
  let kneeR = Math.max(0, -cs) * (0.55 + run * 0.7) * moveW * amp;
  let shoulderL = sn * (0.55 + run * 0.35) * moveW * amp;
  let shoulderR = -sn * (0.55 + run * 0.35) * moveW * amp;
  let elbowL = -(0.15 + run * 0.85) * moveW - 0.05;
  let elbowR = elbowL;
  // z rotation = swing outward/upward: right arm positive, left arm negative
  let armRz = 0.06 + run * 0.04;
  let armLz = -armRz;
  let bob = -Math.abs(sn) * (0.045 + run * 0.04) * moveW * amp;
  let twist = sn * 0.14 * moveW * amp;
  let leanTarget = (0.05 + run * 0.17) * moveW + clamp(input.slope, -0.4, 0.6) * 0.55 + clamp(accel * 0.004, -0.1, 0.12);
  let headPitch = 0;
  let headYaw = Math.sin(s.clock * 0.45) * 0.22 * idleW;
  let headRoll = 0;
  let rollTarget = clamp(-s.turnRate * 0.035, -0.18, 0.18) * moveW + shift;
  let hipDrop = 0;

  /* ---- airborne pose: tuck on the way up, reach on the way down ---- */
  if (!input.grounded) {
    const rising = input.vy > 0.5;
    const t = rising ? 1 : 0.4;
    thighL = -0.7 * t;
    thighR = 0.15 * t - (rising ? 0.2 : 0);
    kneeL = (rising ? 1.15 : 0.35);
    kneeR = (rising ? 0.4 : 0.25);
    shoulderL = rising ? -1.9 : -0.5;
    shoulderR = rising ? -1.9 : -0.5;
    armRz = rising ? 0.35 : 0.9;
    armLz = -armRz;
    elbowL = elbowR = rising ? -0.3 : -0.2;
    leanTarget = rising ? 0.08 : -0.04;
    bob = 0;
    twist = 0;
  }

  /* ---- anticipation: crouch + arms back just before take-off ---- */
  if (s.windup > 0.01) {
    const w = s.windup;
    thighL = thighR = -0.55 * w;
    kneeL = kneeR = 1.05 * w;
    shoulderL = shoulderR = 0.7 * w;
    elbowL = elbowR = -0.2 * w;
    leanTarget += 0.18 * w;
    hipDrop = -0.16 * w;
  }

  /* ---- emotes (only when standing still) ---- */
  if (input.emote !== s.emote) {
    s.emote = input.emote;
    s.emoteT = 0;
  }
  s.emoteT += dt;
  const emoteOn = input.emote !== 'none' && input.grounded && moveW < 0.2 && s.windup < 0.05;
  s.emoteBlend = damp(s.emoteBlend, emoteOn ? 1 : 0, emoteOn ? 9 : 14, dt);
  const eb = s.emoteBlend;
  if (eb > 0.01) {
    const t = s.emoteT;
    if (s.emote === 'wave') {
      // anticipation: tiny dip, then arm lifts with overshoot, then the wave rides on top
      const lift = easeOutBack(t / 0.35);
      const wag = Math.sin(t * 13) * 0.4 * clamp((t - 0.25) / 0.2, 0, 1);
      armRz = THREE.MathUtils.lerp(armRz, 2.35 * lift, eb);
      shoulderR = shoulderR * (1 - eb);
      elbowR = (-0.9 + wag) * eb + elbowR * (1 - eb);
      headRoll += 0.12 * eb;
      leanTarget -= 0.03 * eb;
      headYaw += -0.15 * eb;
    } else if (s.emote === 'dance') {
      const beat = t * 7.5;
      bob += -Math.abs(Math.sin(beat)) * 0.1 * eb * amp;
      rollTarget += Math.sin(beat) * 0.13 * eb * amp;
      twist += Math.sin(beat * 0.5) * 0.35 * eb * amp;
      thighL = Math.sin(beat) * 0.4 * eb;
      thighR = -Math.sin(beat) * 0.4 * eb;
      kneeL = Math.max(0, Math.sin(beat)) * 0.8 * eb;
      kneeR = Math.max(0, -Math.sin(beat)) * 0.8 * eb;
      armLz = -(1.9 + Math.sin(beat) * 0.5) * eb;
      armRz = (1.9 + Math.sin(beat + Math.PI) * 0.5) * eb;
      elbowL = elbowR = -0.5 * eb;
      headPitch += Math.sin(beat * 2) * 0.12 * eb;
      headRoll += Math.sin(beat) * 0.12 * eb;
    } else if (s.emote === 'cheer') {
      // crouch (anticipation) -> pop up with stretch -> hold with a bounce
      const cyc = (t * 2.6) % 1;
      const crouch = cyc < 0.22 ? Math.sin((cyc / 0.22) * Math.PI * 0.5) : 0;
      const pop = cyc >= 0.22 ? Math.sin(((cyc - 0.22) / 0.78) * Math.PI) : 0;
      hipDrop += (-0.14 * crouch + 0.35 * pop) * eb * amp;
      kneeL = kneeR = (0.9 * crouch + 0.1) * eb;
      thighL = thighR = -0.5 * crouch * eb;
      armRz = (0.6 + 2.0 * (1 - crouch)) * eb;
      armLz = -armRz;
      elbowL = elbowR = -0.25 * eb;
      shoulderL = shoulderR = 0;
      headPitch -= 0.2 * eb;
    }
  }

  /* ---- smooth the whole-body lean / roll (ease, no snapping) ---- */
  s.lean = damp(s.lean, leanTarget, 9, dt);
  s.roll = damp(s.roll, rollTarget, 9, dt);

  /* ---- pack follow-through: spring that lags the body and overshoots ---- */
  const packTarget = -accel * 0.012 - Math.abs(sn) * 0.1 * moveW + (input.grounded ? 0 : clamp(-input.vy * 0.02, -0.3, 0.3)) - s.squashV * 0.02;
  s.packV += (-120 * (s.packRot - packTarget) - 9 * s.packV) * dt;
  s.packRot += s.packV * dt;

  /* ---- write the pose ---- */
  root.rotation.y = s.yaw;
  root.scale.set(sxz, sy, sxz);
  root.position.y = -0.1 + bob + hipDrop * 0.6 - 0.9 * (1 - sy) + breathe * 0.4;
  body.rotation.set(s.lean, twist, s.roll);
  body.scale.set(1, 1 + breathe, 1 + breathe * 0.6);
  body.position.y = hipDrop * 0.4;
  head.rotation.set(headPitch - s.lean * 0.75, headYaw - twist * 0.6, headRoll - s.roll * 0.5);
  legL.rotation.set(thighL, 0, 0);
  legR.rotation.set(thighR, 0, 0);
  shinL.rotation.x = kneeL;
  shinR.rotation.x = kneeR;
  armL.rotation.set(shoulderL, 0, armLz);
  armR.rotation.set(shoulderR, 0, armRz);
  foreL.rotation.x = elbowL;
  foreR.rotation.x = elbowR;
  pack.rotation.x = s.packRot;

  /* ---- blink (secondary action) ---- */
  if (s.blinkT < 0 && s.clock > s.blinkAt) s.blinkT = 0;
  if (s.blinkT >= 0) {
    s.blinkT += dt;
    const b = s.blinkT / 0.14;
    const closed = b >= 1 ? 0 : Math.sin(b * Math.PI);
    if (eyeL) eyeL.scale.y = 1 - closed * 0.92;
    if (eyeR) eyeR.scale.y = 1 - closed * 0.92;
    if (b >= 1) {
      s.blinkT = -1;
      s.blinkAt = s.clock + 2 + Math.random() * 3.5;
    }
  }
}
