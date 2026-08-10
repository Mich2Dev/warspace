/**
 * Catálogo de armas a pie — Styloo Guns Asset Pack (CC0).
 * https://styloo.itch.io/guns-asset-pack
 *
 * Hold profiles (por arma / categoría):
 * - mount / adsMount: dónde queda el pistol-grip (origen del arma) en espacio personaje (−Z adelante)
 * - lengthFrac: tamaño vs charHeight
 * - grips: posición a lo largo del cañón (0=boca, 1=culata) + offset lateral/altura
 * - twoHand: IK de mano izquierda al handguard
 */

export const WEAPON_SLOT_COUNT = 8;

/** @typedef {'rifle'|'smg'|'pistol'|'sniper'|'heavy'} WeaponCategory */

/**
 * @typedef {Object} GripPoint
 * @property {number} along  0 = boca del cañón, 1 = culata
 * @property {number} [x]
 * @property {number} [y]  negativo = bajo el cañón
 */

/**
 * @typedef {Object} HoldProfile
 * @property {boolean} twoHand
 * @property {{x:number,y:number,z:number,rx?:number,ry?:number,rz?:number}} mount
 * @property {{x:number,y:number,z:number,rx?:number,ry?:number,rz?:number}} adsMount
 * @property {GripPoint} gripR
 * @property {GripPoint} [gripL]
 */

/** @typedef {Object} WeaponDef
 * @property {string} id
 * @property {string} name
 * @property {WeaponCategory} category
 * @property {string} modelUrl
 * @property {number} slot
 * @property {number} lengthFrac
 * @property {number} [heightCapFrac]  tope de altura del arma vs charHeight (anti-monstruo)
 * @property {'x'|'z'} longAxis
 * @property {HoldProfile} hold
 * @property {{x:number,y:number,z:number}} muzzle
 * @property {number} damage
 * @property {number} fireRateMs
 * @property {number} projectileSpeed
 * @property {number} colorHex
 * @property {number} recoilKick
 * @property {string} [blurb]
 * // compat legacy (WeaponSystem merge):
 * @property {object} [mount]
 * @property {object} [adsMount]
 * @property {object} [grip]
 * @property {object} [adsGrip]
 */

const H = 150;
const STYLOO = '/models/weapons/styloo/glb';

/** Dedos cerrados */
export const GRIP_FINGERS = {
  RightHandThumb1: [0.45, 0.55, 0.25],
  RightHandThumb2: [0.55, 0, 0],
  RightHandThumb3: [0.45, 0, 0],
  RightHandIndex1: [0.75, 0, 0],
  RightHandIndex2: [0.95, 0, 0],
  RightHandIndex3: [0.65, 0, 0],
  RightHandMiddle1: [0.8, 0, 0],
  RightHandMiddle2: [1.0, 0, 0],
  RightHandMiddle3: [0.7, 0, 0],
  RightHandRing1: [0.75, 0, 0],
  RightHandRing2: [0.95, 0, 0],
  RightHandRing3: [0.65, 0, 0],
  RightHandPinky1: [0.7, 0, 0],
  RightHandPinky2: [0.85, 0, 0],
  LeftHandThumb1: [0.4, -0.45, -0.2],
  LeftHandThumb2: [0.45, 0, 0],
  LeftHandIndex1: [0.7, 0, 0],
  LeftHandIndex2: [0.9, 0, 0],
  LeftHandIndex3: [0.6, 0, 0],
  LeftHandMiddle1: [0.75, 0, 0],
  LeftHandMiddle2: [0.95, 0, 0],
  LeftHandMiddle3: [0.65, 0, 0],
  LeftHandRing1: [0.7, 0, 0],
  LeftHandRing2: [0.9, 0, 0],
  LeftHandRing3: [0.6, 0, 0],
  LeftHandPinky1: [0.65, 0, 0],
  LeftHandPinky2: [0.8, 0, 0]
};

/** Perfiles de hold por categoria (origen = pistol grip).
 * grip.x / grip.y = fraccion del semi-ancho / semi-alto (manos FUERA del mesh).
 * along: 0=boca ... 1=culata
 */
const HOLD_RIFLE = {
  twoHand: true,
  autoGrip: true,
  // lateral / drop / forward = offsets desde hombro derecho en marco de mira
  mount: { lateral: 11, drop: -26, forward: 12, x: 10, y: H * 0.58, z: -14 },
  adsMount: { lateral: 5, drop: -12, forward: 17, x: 5, y: H * 0.76, z: -16 },
  gripR: { along: 0.84, x: 0.22, y: -0.4 },
  gripL: { along: 0.68, x: -0.36, y: -0.3 }
};

const HOLD_SMG = {
  twoHand: true,
  autoGrip: true,
  mount: { lateral: 8, drop: -28, forward: 12, x: 11, y: H * 0.57, z: -12 },
  adsMount: { lateral: 4, drop: -14, forward: 16, x: 6, y: H * 0.74, z: -14 },
  gripR: { along: 0.78, x: 0.2, y: -0.4 },
  gripL: { along: 0.58, x: -0.35, y: -0.3 }
};

const HOLD_SHOTGUN = {
  twoHand: true,
  autoGrip: true,
  mount: { lateral: 9, drop: -30, forward: 13, x: 10, y: H * 0.56, z: -13 },
  adsMount: { lateral: 4, drop: -14, forward: 17, x: 6, y: H * 0.74, z: -15 },
  gripR: { along: 0.84, x: 0.2, y: -0.4 },
  gripL: { along: 0.6, x: -0.36, y: -0.28 }
};

const HOLD_PISTOL = {
  twoHand: false,
  autoGrip: true,
  mount: { lateral: 12, drop: -26, forward: 16, x: 16, y: H * 0.58, z: -16 },
  adsMount: { lateral: 6, drop: -12, forward: 18, x: 10, y: H * 0.76, z: -14 },
  gripR: { along: 0.55, x: 0.15, y: -0.4 },
  gripL: { along: 0.55, x: 0.15, y: -0.4 }
};

const HOLD_SNIPER = {
  twoHand: true,
  autoGrip: true,
  mount: { lateral: 8, drop: -30, forward: 15, x: 9, y: H * 0.57, z: -15 },
  adsMount: { lateral: 3, drop: -12, forward: 19, x: 4, y: H * 0.77, z: -16 },
  gripR: { along: 0.84, x: 0.2, y: -0.42 },
  gripL: { along: 0.64, x: -0.36, y: -0.3 }
};

const HOLD_HEAVY = {
  twoHand: true,
  autoGrip: true,
  mount: { lateral: 8, drop: -34, forward: 14, x: 8, y: H * 0.52, z: -14 },
  adsMount: { lateral: 4, drop: -16, forward: 17, x: 5, y: H * 0.7, z: -15 },
  gripR: { along: 0.8, x: 0.22, y: -0.4 },
  gripL: { along: 0.62, x: -0.36, y: -0.28 }
};

function withHold(hold, overrides = {}) {
  return {
    ...hold,
    ...overrides,
    mount: { ...hold.mount, ...(overrides.mount || {}) },
    adsMount: { ...hold.adsMount, ...(overrides.adsMount || {}) },
    gripR: { ...hold.gripR, ...(overrides.gripR || {}) },
    gripL: { ...hold.gripL, ...(overrides.gripL || {}) }
  };
}

/**
 * Slots 1–8 Styloo (pack sin pistola → slot 6 = MAC-10 a una mano).
 * @type {WeaponDef[]}
 */
export const WEAPON_DEFS = [
  {
    id: 'ak47',
    name: 'AK-47',
    category: 'rifle',
    modelUrl: `${STYLOO}/ak47.glb`,
    slot: 1,
    // ~0.9 m de cañón a culata — rifle épico, no juguete
    lengthFrac: 0.60,
    heightCapFrac: 0.17,
    longAxis: 'x',
    hold: withHold(HOLD_RIFLE),
    mount: HOLD_RIFLE.mount,
    adsMount: HOLD_RIFLE.adsMount,
    muzzle: { x: 0, y: 2, z: -0.48 },
    grip: null,
    adsGrip: null,
    damage: 16,
    fireRateMs: 160,
    projectileSpeed: 24000,
    colorHex: 0xff7722,
    recoilKick: 1,
    blurb: 'AK-47 — estándar'
  },
  {
    id: 'ak47_v',
    name: 'AK Variant',
    category: 'rifle',
    modelUrl: `${STYLOO}/ak47variant.glb`,
    slot: 2,
    lengthFrac: 0.52,
    heightCapFrac: 0.16,
    longAxis: 'x',
    hold: withHold(HOLD_RIFLE, {
      gripR: { along: 0.84 },
      gripL: { along: 0.64 }
    }),
    mount: HOLD_RIFLE.mount,
    adsMount: HOLD_RIFLE.adsMount,
    muzzle: { x: 0, y: 2, z: -0.48 },
    grip: null,
    adsGrip: null,
    damage: 15,
    fireRateMs: 150,
    projectileSpeed: 23500,
    colorHex: 0xff8833,
    recoilKick: 0.9,
    blurb: 'AK compacta'
  },
  {
    id: 'pew',
    name: 'PEW',
    category: 'smg',
    modelUrl: `${STYLOO}/pew.glb`,
    slot: 3,
    // Mesh corto (aspect ~1.5): si se escala a rifle se ve pistola gigante
    lengthFrac: 0.34,
    heightCapFrac: 0.15,
    longAxis: 'x',
    hold: withHold(HOLD_SMG),
    mount: HOLD_SMG.mount,
    adsMount: HOLD_SMG.adsMount,
    muzzle: { x: 0, y: 2, z: -0.48 },
    grip: null,
    adsGrip: null,
    damage: 14,
    fireRateMs: 120,
    projectileSpeed: 22000,
    colorHex: 0xff6611,
    recoilKick: 0.75,
    blurb: 'PDW compacto'
  },
  {
    id: 'shotgun',
    name: 'Shotgun',
    category: 'rifle',
    modelUrl: `${STYLOO}/shotgun.glb`,
    slot: 4,
    lengthFrac: 0.58,
    heightCapFrac: 0.15,
    longAxis: 'x',
    hold: withHold(HOLD_SHOTGUN),
    mount: HOLD_SHOTGUN.mount,
    adsMount: HOLD_SHOTGUN.adsMount,
    muzzle: { x: 0, y: 2, z: -0.48 },
    grip: null,
    adsGrip: null,
    damage: 28,
    fireRateMs: 420,
    projectileSpeed: 18000,
    colorHex: 0xffaa44,
    recoilKick: 1.4,
    blurb: 'Escopeta — support adelante'
  },
  {
    id: 'mac10',
    name: 'MAC-10',
    category: 'smg',
    modelUrl: `${STYLOO}/mac10.glb`,
    slot: 5,
    // Casi cúbico: limitar altura o parece un bloque
    lengthFrac: 0.30,
    heightCapFrac: 0.14,
    longAxis: 'x',
    hold: withHold(HOLD_SMG),
    mount: HOLD_SMG.mount,
    adsMount: HOLD_SMG.adsMount,
    muzzle: { x: 0, y: 1.5, z: -0.45 },
    grip: null,
    adsGrip: null,
    damage: 10,
    fireRateMs: 90,
    projectileSpeed: 21000,
    colorHex: 0x66ddff,
    recoilKick: 0.55,
    blurb: 'Cadencia alta — agarre corto'
  },
  {
    id: 'sidearm',
    name: 'Sidearm',
    category: 'pistol',
    modelUrl: `${STYLOO}/mac10.glb`,
    slot: 6,
    lengthFrac: 0.18,
    heightCapFrac: 0.11,
    longAxis: 'x',
    hold: withHold(HOLD_PISTOL),
    mount: HOLD_PISTOL.mount,
    adsMount: HOLD_PISTOL.adsMount,
    muzzle: { x: 0, y: 1, z: -0.4 },
    grip: null,
    adsGrip: null,
    damage: 12,
    fireRateMs: 220,
    projectileSpeed: 20000,
    colorHex: 0xffcc55,
    recoilKick: 0.7,
    blurb: 'Una mano'
  },
  {
    id: 'awp',
    name: 'AWP',
    category: 'sniper',
    modelUrl: `${STYLOO}/awp.glb`,
    slot: 7,
    lengthFrac: 0.70,
    heightCapFrac: 0.15,
    longAxis: 'x',
    hold: withHold(HOLD_SNIPER),
    mount: HOLD_SNIPER.mount,
    adsMount: HOLD_SNIPER.adsMount,
    muzzle: { x: 0, y: 2.5, z: -0.52 },
    grip: null,
    adsGrip: null,
    damage: 42,
    fireRateMs: 650,
    projectileSpeed: 32000,
    colorHex: 0xaa66ff,
    recoilKick: 1.6,
    blurb: 'Largo — support hand adelante'
  },
  {
    id: 'rocket',
    name: 'Rocket Launcher',
    category: 'heavy',
    modelUrl: `${STYLOO}/rocketlaucher.glb`,
    slot: 8,
    lengthFrac: 0.56,
    heightCapFrac: 0.20,
    longAxis: 'x',
    hold: withHold(HOLD_HEAVY),
    mount: HOLD_HEAVY.mount,
    adsMount: HOLD_HEAVY.adsMount,
    muzzle: { x: 0, y: 2, z: -0.42 },
    grip: null,
    adsGrip: null,
    damage: 55,
    fireRateMs: 900,
    projectileSpeed: 12000,
    colorHex: 0xff4422,
    recoilKick: 1.8,
    blurb: 'Pesada — más baja'
  }
];

export function getWeaponDef(id) {
  return WEAPON_DEFS.find((w) => w.id === id) || null;
}

export function getWeaponBySlot(slot) {
  return WEAPON_DEFS.find((w) => w.slot === slot) || null;
}

export function listWeapons() {
  return WEAPON_DEFS.slice();
}
