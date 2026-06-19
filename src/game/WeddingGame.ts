import Phaser from 'phaser';
import wedding from '../data/wedding.json';
import levels from '../data/levels.json';
import spriteBounds from '../data/spriteBounds.json';

/* ------------------------------------------------------------------ *
 *  Путь к Кате — portrait-first pixel-art wedding mini-game.
 *  Config-driven foreground-scroll side-scroller: clean static
 *  backgrounds + scrolling decor / obstacles / collectibles + FX.
 *  Layout lives in src/data/levels.json; copy in src/data/wedding.json.
 * ------------------------------------------------------------------ */

const GAME_WIDTH = levels.canvas.width;
const GAME_HEIGHT = levels.canvas.height;
const DEFAULT_GROUND_Y = levels.canvas.groundY;
const PLAYER_X = levels.player.x;
const PLAYER_H = levels.player.h;
const SPEED = levels.speed;
const COLLECTIBLE_H = levels.collectibleH;

const GAME_ASSETS = '/assets/game';
const LANDING_URL = '/main/';
const FONT_PIXEL = '"Press Start 2P", ui-monospace, monospace'; // title, HUD, headers (short, blocky)
const FONT_BODY = '"Rubik", ui-sans-serif, system-ui, sans-serif'; // sentences (readable)

// physics tuning (gentle, forgiving)
const GRAVITY = 2050;
const JUMP_V = -690;
const HOLD_LIFT = 1550;
const STAGE_MS = 11000;
const HUD_GUARD_Y = 74;
const FINISH_PAD_MS = 1200;
const INTRO_PRIMARY_Y = 712;
const INTRO_SKIP_Y = 772;
const INTRO_CHARACTER_Y = 674; // feet rest on the promenade tiles in intro.webp (~y644–678)
const RUNNER_SKIP_Y = GAME_HEIGHT - 42;
const LEVEL_COLLECT_GOAL = 5;

// palette
const C_NAVY = 0x16223c;
const C_NAVY_DARK = 0x0b1120;
const C_GOLD = 0xd8b483;
const C_PINK = 0xd66a80;
const C_PINK_HI = 0xe88ca0;
const C_PINK_DK = 0x7d2f43;
const T_CREAM = '#f3e6d2';
const T_GOLD = '#ecc079';
const T_PINK = '#eca8bb';

// Kaya scrolls in with the world, peeking from behind a cover object.
// dx = her x offset from the cover (which side she peeks); both scroll together.
const KAYA_SPOTS = [
  { cover: 'furniture/plant', coverH: 92, dx: 26 },
  { cover: 'obstacles/bollard', coverH: 58, dx: 22 },
  { cover: 'decor/flower-box', coverH: 64, dx: -44 },
] as const;

export type GameController = {
  destroy: () => void;
  pause: () => void;
  resume: () => void;
};

type DecorEntry = { key: string; h: number; yOffset?: number; glow?: boolean };
type ObstacleEntry = { key: string; h: number; air?: number };
type LevelConfig = {
  id: string;
  background: string;
  groundY?: number;
  backgroundZoom?: number;
  tint?: string;
  rain?: boolean;
  decor: DecorEntry[];
  obstacles: ObstacleEntry[];
  collectibles: string[];
  kaya: { texture: string; h: number };
};
const LEVELS = levels.levels as LevelConfig[];

const stageMeta = [
  { title: 'Собраться', subtitle: 'Сборы жениха', objective: 'Собери 3/5 предметов', reveal: ['Дата свадьбы', wedding.date_display] },
  {
    title: 'Не опоздать',
    subtitle: 'Тайминг дня',
    objective: 'Сохрани сердечки',
    reveal: [
      `${wedding.timeline[0].time} — сбор`,
      `${wedding.timeline[1].time} — церемония`,
      `${wedding.timeline[2].time} — банкет`,
      `${wedding.timeline[3].time} — финал`,
    ],
  },
  {
    title: 'Добраться до места',
    subtitle: 'Почти на месте',
    objective: 'Доберись до арки',
    reveal: [wedding.location.name, `${wedding.location.city}, ${wedding.location.address}`],
  },
];

function isCompactViewport() {
  return window.innerHeight <= 667 || window.innerWidth <= 340;
}

/* resolve a sprite key to its file url */
function assetUrl(key: string) {
  if (key === 'paw-icon') return `${GAME_ASSETS}/kaya/paw.png`;
  if (key.includes('/')) return `${GAME_ASSETS}/v3/${key}.png`; // obstacles/.., decor/.., furniture/.., fx/..
  if (key.startsWith('collectible-')) return `${GAME_ASSETS}/props/${key}.png`;
  if (key.startsWith('kaya')) return `${GAME_ASSETS}/kaya/${key}.png`;
  return `${GAME_ASSETS}/characters/${key}.png`;
}

function bgKeyFor(name: string) {
  if (name === 'room') return 'bg-room';
  if (name === 'rain') return 'bg-rain';
  return 'bg-embankment';
}

/* ------------------------------------------------------------------ *
 *  Safe-area framing. The canvas fills the whole screen, so the island
 *  overlaps the top and the toolbar / home indicator overlap the bottom.
 *  We measure the visible band (visualViewport + env insets) and keep UI
 *  inside it: static scenes (intro/finale) scroll the whole world up so the
 *  buttons clear the toolbar while art stays grounded, and pin the top
 *  cluster (title) down past the island; the runner just nudges its HUD
 *  down and its skip button up. Re-applied on viewport / chrome changes.
 * ------------------------------------------------------------------ */
type Pinned = Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.ScrollFactor;
type Shifted = { obj: { y: number }; baseY: number };
const shiftItem = (obj: { y: number }): Shifted => ({ obj, baseY: obj.y });

function parsePx(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/* visible band of the canvas in game-space px: where the island stops (top) and
   where the toolbar / home indicator begins (bottom). */
function viewportBand(scene: Phaser.Scene): { topGame: number; bottomGame: number } {
  const canvas = scene.game.canvas;
  const rect = canvas?.getBoundingClientRect();
  const scale = rect && rect.width > 0 ? rect.width / GAME_WIDTH : 1;
  const root = getComputedStyle(document.documentElement);
  const insetTop = parsePx(root.getPropertyValue('--safe-top'));
  const insetBottom = parsePx(root.getPropertyValue('--safe-bottom'));
  const top = rect?.top ?? 0;
  const visibleBottomCss = (window.visualViewport?.height ?? window.innerHeight) - insetBottom;
  return {
    topGame: Math.max(0, (insetTop - top) / scale),
    bottomGame: Math.min(GAME_HEIGHT, (visibleBottomCss - top) / scale),
  };
}

function onViewportChange(scene: Phaser.Scene, apply: () => void) {
  apply();
  scene.scale.on('resize', apply);
  const vv = window.visualViewport;
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off('resize', apply);
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
  });
}

/* Static scene: scroll the whole world up so `bottomEdge` clears the toolbar, then
   pin the top cluster (scrollFactor 0) just below the island. Art + buttons move
   together (camera), so nothing overlaps. */
function frameStaticScene(scene: Phaser.Scene, topItems: Pinned[], topRef: number, bottomEdge: number, topGap = 46, botMargin = 10) {
  topItems.forEach((it) => it.setScrollFactor(0));
  const bases = topItems.map((it) => it.y);
  onViewportChange(scene, () => {
    const band = viewportBand(scene);
    scene.cameras.main.setScroll(0, Math.max(0, bottomEdge - (band.bottomGame - botMargin)));
    const topShift = Math.max(0, band.topGame + topGap - topRef);
    topItems.forEach((it, i) => (it.y = bases[i] + topShift));
  });
}

/* Runner: nudge the HUD down past the island and the skip button up past the toolbar. */
function frameRunner(scene: Phaser.Scene, topItems: Shifted[], topRef: number, botItems: Shifted[], botRef: number, margin = 10) {
  onViewportChange(scene, () => {
    const band = viewportBand(scene);
    const topShift = Math.max(0, band.topGame + margin - topRef);
    const botShift = Math.max(0, botRef - (band.bottomGame - margin));
    topItems.forEach((it) => (it.obj.y = it.baseY + topShift));
    botItems.forEach((it) => (it.obj.y = it.baseY - botShift));
  });
}

function scaleTo(img: Phaser.GameObjects.Image, h: number) {
  const bounds = (spriteBounds as Record<string, { contentHeight: number }>)[img.texture.key];
  img.setScale(h / (bounds?.contentHeight ?? img.height));
  return img;
}

function scaleToWidth(img: Phaser.GameObjects.Image, w: number) {
  const bounds = (spriteBounds as Record<string, { contentWidth: number }>)[img.texture.key];
  img.setScale(w / (bounds?.contentWidth ?? img.width));
  return img;
}

/* scale so the larger content dimension equals `size` — keeps mixed-aspect props
   (a tall suit vs a wide bow tie) at comparable visual weight */
function scaleToMax(img: Phaser.GameObjects.Image, size: number) {
  const b = (spriteBounds as Record<string, { contentWidth: number; contentHeight: number }>)[img.texture.key];
  const cw = b?.contentWidth ?? img.width;
  const ch = b?.contentHeight ?? img.height;
  img.setScale(size / Math.max(cw, ch));
  return img;
}

// per-prop target size (largest dimension, px) so pickups read at true relative scale
const COLLECTIBLE_SIZE: Record<string, number> = {
  'collectible-suit': 60,
  'collectible-bouquet': 56,
  'collectible-envelope': 46,
  'collectible-heart': 42,
  'collectible-ring': 42,
  'collectible-bow': 42,
};

function keepInside(img: Phaser.GameObjects.Image, pad: number) {
  const half = img.displayWidth / 2;
  if (img.displayWidth + pad * 2 >= GAME_WIDTH) return img;
  img.x = Phaser.Math.Clamp(img.x, half + pad, GAME_WIDTH - half - pad);
  return img;
}

function hexTint(s?: string) {
  return s ? parseInt(s.replace('#', ''), 16) : undefined;
}

function emitGameEvent(name: string, detail: Record<string, string | number | boolean> = {}) {
  window.dispatchEvent(new CustomEvent(`wedding-game-${name}`, { detail }));
}

function track(name: string, detail: Record<string, string | number | boolean> = {}) {
  emitGameEvent('analytics', { name, ...detail });
  const w = window as unknown as { dataLayer?: Array<Record<string, unknown>> };
  w.dataLayer?.push({ event: `wedding_game_${name}`, ...detail });
}

/* Respect the OS "reduce motion" setting for decorative (non-gameplay) motion. */
function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/* Looping ambient tween (glow pulse, bob, sway). No-op when reduced motion is on. */
function ambientLoop(scene: Phaser.Scene, config: Phaser.Types.Tweens.TweenBuilderConfig) {
  if (prefersReducedMotion()) return undefined;
  return scene.tweens.add(config);
}

/* Tiny WebAudio SFX — synthesized on the fly, no asset files. Muted state
   persists in localStorage; the AudioContext resumes on first user gesture. */
const SFX_MUTE_KEY = 'wedding-sfx-muted';
const sfx = (() => {
  let ctx: AudioContext | undefined;
  let muted = (() => {
    try {
      return localStorage.getItem(SFX_MUTE_KEY) === '1';
    } catch {
      return false;
    }
  })();
  const audio = () => {
    if (typeof window === 'undefined') return undefined;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return undefined;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  };
  const tone = (freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0) => {
    if (muted) return;
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur);
  };
  return {
    jump: () => tone(420, 0.16, 'square', 0.04, 760),
    collect: () => {
      tone(880, 0.09, 'triangle', 0.05);
      tone(1320, 0.12, 'triangle', 0.045, undefined, 0.07);
    },
    hit: () => tone(220, 0.22, 'sawtooth', 0.05, 90),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, 'triangle', 0.05, undefined, i * 0.13)),
    isMuted: () => muted,
    toggle: () => {
      muted = !muted;
      try {
        localStorage.setItem(SFX_MUTE_KEY, muted ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (!muted) audio();
      return muted;
    },
  };
})();

export function mountWeddingGame(parent: HTMLElement): GameController {
  parent.innerHTML = '';
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#10182a',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, IntroScene, RunnerScene, FinaleScene],
  };
  const game = new Phaser.Game(config);
  game.registry.set('wedding', wedding);

  // iOS browsers (notably Arc, whose toolbar floats over the page) resize the
  // visual viewport when chrome shows/hides without always firing a window
  // 'resize'. Without refreshing, Phaser's cached canvas bounds go stale and
  // pointer hits land off-target — making buttons near the toolbar untappable.
  const refresh = () => game.scale.refresh();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', refresh);
  vv?.addEventListener('scroll', refresh);
  window.addEventListener('orientationchange', refresh);

  return {
    destroy: () => {
      vv?.removeEventListener('resize', refresh);
      vv?.removeEventListener('scroll', refresh);
      window.removeEventListener('orientationchange', refresh);
      game.destroy(true);
    },
    pause: () => game.loop.sleep(),
    resume: () => game.loop.wake(),
  };
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */
class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // A single flaky asset must NOT kill the whole game. Some mobile browsers
    // (e.g. Yandex Browser's Turbo/data-saver proxy, or built-in ad-blockers)
    // intermittently drop a request. Collect failures, retry them once with a
    // cache-buster, and only hard-fail if a *critical* texture is still missing
    // after the retry — otherwise let the game run and degrade gracefully.
    const failures = new Map<string, string>();
    let retried = false;
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      failures.set(file.key, typeof file.url === 'string' ? file.url : assetUrl(file.key));
    });
    this.load.on('complete', () => {
      if (failures.size === 0) return;
      if (!retried) {
        retried = true;
        const entries = [...failures];
        failures.clear();
        entries.forEach(([key, url]) => {
          const bust = `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`;
          this.load.image(key, bust);
        });
        this.load.start();
        return;
      }
      const stillFailed = [...failures.keys()];
      const critical = stillFailed.some(
        (k) => k.startsWith('bg-') || k.startsWith('groom-') || k.startsWith('bride-'),
      );
      if (critical) emitGameEvent('error', { reason: 'asset-load', failed: stillFailed.join(',') });
    });
    this.load.image('bg-room', `${GAME_ASSETS}/backgrounds/level1_room.webp`);
    this.load.image('bg-rain', `${GAME_ASSETS}/backgrounds/level2_rain.webp`);
    this.load.image('bg-embankment', `${GAME_ASSETS}/backgrounds/level3_embankment.webp`);
    this.load.image('bg-hero', `${GAME_ASSETS}/backgrounds/intro.webp`);
    this.load.image('bg-finale', `${GAME_ASSETS}/backgrounds/finale.webp`);

    [
      'groom-idle',
      'groom-run-1',
      'groom-run-2',
      'groom-run-3',
      'groom-run-4',
      'groom-jump',
      'groom-land',
      'bride-idle',
      'bride-wave',
      'couple-pose',
    ].forEach((k) => this.load.image(k, `${GAME_ASSETS}/characters/${k}.png`));
    this.load.image('sign-katya', `${GAME_ASSETS}/props/sign-katya.png`);
    this.load.image('paw-icon', `${GAME_ASSETS}/kaya/paw.png`);
    // extra Kaya frame for the finale blink animation (tail swish comes later)
    this.load.image('kaya-sit-blink', `${GAME_ASSETS}/kaya/kaya-sit-blink.png`);

    const keys = new Set<string>();
    LEVELS.forEach((l) => {
      l.decor.forEach((d) => keys.add(d.key));
      l.obstacles.forEach((o) => keys.add(o.key));
      l.collectibles.forEach((c) => keys.add(c));
      keys.add(l.kaya.texture);
    });
    [
      'collectible-heart',
      'collectible-ring',
      'fx/sparkle-1',
      'fx/sparkle-2',
      'fx/sparkle-3',
      'fx/sparkle-4',
      'fx/heart-1',
      'fx/heart-2',
      'fx/heart-3',
      'fx/dust-1',
      'fx/dust-2',
      'fx/dust-3',
      'fx/dust-4',
    ].forEach((k) => keys.add(k));
    keys.forEach((k) => this.load.image(k, assetUrl(k)));

    const bar = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, 240, 8, 0x2a3756).setOrigin(0.5);
    const fill = this.add.rectangle(bar.x - 120, bar.y, 1, 8, C_GOLD).setOrigin(0, 0.5);
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 8, 'Загрузка…', { fontFamily: FONT_BODY, fontSize: '22px', color: T_CREAM })
      .setOrigin(0.5);
    this.load.on('progress', (p: number) => fill.setSize(240 * p, 8));
  }

  create() {
    this.makeGlowTexture();
    this.makeUiHeartTexture();
    this.makeRaindropTexture();
    this.makePetalTexture();
    this.registerFxAnims();

    const hash = window.location.hash;
    if (hash === '#finale-kaya') this.registry.set('kayaFound', 3);
    const target = hash.startsWith('#runner') ? 'RunnerScene' : hash.startsWith('#finale') ? 'FinaleScene' : 'IntroScene';
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      emitGameEvent('ready');
      this.scene.start(target);
    };
    // Wait for web fonts, but never block the game on a slow/blocked font CDN:
    // start anyway after a short timeout so players don't get stuck on "Загрузка…".
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) {
      Promise.all([fonts.load('16px "Press Start 2P"'), fonts.load('400 18px "Rubik"'), fonts.load('700 18px "Rubik"')])
        .then(() => fonts.ready)
        .then(start, start);
      this.time.delayedCall(2500, start);
    } else {
      start();
    }
  }

  private makeGlowTexture() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    for (let r = 100; r > 0; r -= 3) {
      g.fillStyle(0xffffff, 0.035);
      g.fillCircle(100, 100, r);
    }
    g.generateTexture('fx/glow', 200, 200);
    g.destroy();
  }

  private makeUiHeartTexture() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const s = 4;
    const px = (x: number, y: number, w = 1, h = 1, color = 0xd66a80) => g.fillStyle(color, 1).fillRect(x * s, y * s, w * s, h * s);
    const outline = [
      [2, 1, 2, 1], [5, 1, 2, 1],
      [1, 2, 7, 1],
      [0, 3, 9, 2],
      [1, 5, 7, 1],
      [2, 6, 5, 1],
      [3, 7, 3, 1],
      [4, 8, 1, 1],
    ];
    outline.forEach(([x, y, w, h]) => px(x, y, w, h, 0x0b1120));
    [
      [2, 2, 2, 1], [5, 2, 2, 1],
      [1, 3, 7, 1],
      [1, 4, 7, 1],
      [2, 5, 5, 1],
      [3, 6, 3, 1],
      [4, 7, 1, 1],
    ].forEach(([x, y, w, h]) => px(x, y, w, h));
    px(2, 3, 1, 1, 0xf0a1ad);
    px(6, 2, 1, 1, 0xf3b4bd);
    g.generateTexture('ui-heart', 9 * s, 10 * s);
    g.destroy();
  }

  private makeRaindropTexture() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xc7d6ec, 1).fillRect(0, 0, 2, 13);
    g.generateTexture('fx/raindrop', 2, 13);
    g.destroy();
  }

  private makePetalTexture() {
    // the sheet petals are green-contaminated; a clean procedural petal tints + spins nicely
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xf3aec0, 1).fillEllipse(8, 11, 14, 20);
    g.fillStyle(0xe98aa6, 1).fillEllipse(8, 13, 9, 13);
    g.generateTexture('fx/petal', 16, 22);
    g.destroy();
  }

  private registerFxAnims() {
    const make = (key: string, prefix: string, n: number, rate: number) => {
      if (this.anims.exists(key)) return;
      const frames = [];
      for (let i = 1; i <= n; i += 1) frames.push({ key: `${prefix}-${i}` });
      this.anims.create({ key, frames, frameRate: rate, repeat: 0 });
    };
    make('fx-sparkle', 'fx/sparkle', 4, 18);
    make('fx-heart', 'fx/heart', 3, 13);
    make('fx-dust', 'fx/dust', 4, 20);
  }
}

/* ------------------------------------------------------------------ */
/* Intro                                                              */
/* ------------------------------------------------------------------ */
class IntroScene extends Phaser.Scene {
  constructor() {
    super('IntroScene');
  }

  create() {
    const compact = isCompactViewport();
    addSceneBackground(this, 'bg-hero');
    addGroundBand(this);
    // lit lamp post on the left, standing on the promenade
    const lamp = scaleTo(this.add.image(34, INTRO_CHARACTER_Y, 'decor/lamp-post').setOrigin(0.5, 1).setDepth(5), compact ? 188 : 210);
    const lampGlow = this.add
      .image(lamp.x, lamp.y - lamp.displayHeight * 0.84, 'fx/glow')
      .setDepth(4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffcf8a)
      .setDisplaySize(154, 154)
      .setAlpha(0.5);
    ambientLoop(this, { targets: lampGlow, alpha: 0.74, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.easeInOut' });
    // the couple anchors the scene: larger, standing together, signpost on the right
    scaleTo(this.add.image(326, INTRO_CHARACTER_Y, 'sign-katya').setOrigin(0.5, 1).setDepth(5), compact ? 92 : 100);
    scaleTo(this.add.image(148, INTRO_CHARACTER_Y, 'groom-idle').setOrigin(0.5, 1).setDepth(6), compact ? 144 : 156);
    // Катя ждёт и зовёт Андрея: спокойное ожидание, иногда машет «сюда».
    const brideH = compact ? 138 : 150;
    const bride = scaleTo(this.add.image(224, INTRO_CHARACTER_Y, 'bride-idle').setOrigin(0.5, 1).setDepth(6), brideH);
    const setBride = (key: string) => scaleTo(bride.setTexture(key), brideH);
    const waveCycle = () => {
      this.time.delayedCall(1500, () => {
        setBride('bride-wave');
        this.time.delayedCall(1000, () => {
          setBride('bride-idle');
          waveCycle();
        });
      });
    };
    waveCycle();

    // centered title; the heart trails "ПУТЬ" on line 1 with a clean gap, the whole
    // line-1 group (text + gap + heart) centered on the canvas
    const titleSize = compact ? 28 : 32;
    const heartW = compact ? 28 : 32;
    const heartH = compact ? 31 : 36;
    const heartGap = compact ? 12 : 14;
    const line1 = titleText(this, 0, 30, 'ПУТЬ', titleSize);
    const line1W = line1.width + heartGap + heartW;
    line1.setX(Math.round(GAME_WIDTH / 2 - line1W / 2));
    const heart = this.add
      .image(Math.round(line1.x + line1.width + heartGap + heartW / 2), Math.round(line1.y + line1.height / 2), 'ui-heart')
      .setDepth(23)
      .setDisplaySize(heartW, heartH);
    const line2 = titleText(this, 0, 74, 'К КАТЕ', titleSize);
    line2.setX(Math.round(GAME_WIDTH / 2 - line2.width / 2));
    const subtitle = this.add
      .text(GAME_WIDTH / 2, 120, 'Помоги Андрею добраться\nдо невесты', {
        fontFamily: FONT_BODY,
        fontSize: compact ? '15px' : '16px',
        color: T_PINK,
        align: 'center',
        lineSpacing: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(20);

    const bubble = speechBubble(this, GAME_WIDTH / 2, 198, compact ? 214 : 226, 44);
    // touch devices tap; pointer-fine (desktop) gets the keyboard hint instead
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? true;
    const jumpHint = touch ? 'Тапни, чтобы прыгнуть  ↑' : 'Пробел, чтобы прыгнуть  ↑';
    const bubbleText = this.add
      .text(GAME_WIDTH / 2, 196, jumpHint, { fontFamily: FONT_BODY, fontSize: compact ? '12px' : '13px', color: T_CREAM })
      .setOrigin(0.5)
      .setDepth(20);

    pixelButton(this, GAME_WIDTH / 2, INTRO_PRIMARY_Y, compact ? 284 : 300, compact ? 50 : 52, 'Начать путь', 'primary', () => {
      track('start');
      this.scene.start('RunnerScene');
    }, compact ? 16 : 17);
    const skipH = compact ? 32 : 34;
    pixelButton(this, GAME_WIDTH / 2, INTRO_SKIP_Y, compact ? 176 : 188, skipH, 'Пропустить игру', 'secondary', () => {
      track('skip', { from: 'intro' });
      this.scene.start('FinaleScene');
    }, compact ? 11 : 12).setAlpha(0.8);

    // keyboard players can't tab to the canvas buttons → Enter / Space starts the run
    this.input.keyboard?.addCapture(['SPACE', 'ENTER']); // don't let Space scroll the page
    const startByKey = () => {
      track('start');
      this.scene.start('RunnerScene');
    };
    this.input.keyboard?.on('keydown-ENTER', startByKey);
    this.input.keyboard?.on('keydown-SPACE', startByKey);

    // full-screen canvas → pin the title block below the island; the couple, signpost
    // and buttons scroll up together so the buttons clear the toolbar (no overlap).
    frameStaticScene(this, [line1, heart, line2, subtitle, bubble, bubbleText], 30, INTRO_SKIP_Y + skipH / 2);
  }
}

/* ------------------------------------------------------------------ */
/* Runner                                                             */
/* ------------------------------------------------------------------ */
type Mover = { obj: Phaser.GameObjects.Image; vx: number; cloud?: boolean; hit?: boolean; revealWhenInside?: boolean; glow?: Phaser.GameObjects.Image };

class RunnerScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private groundY = DEFAULT_GROUND_Y;
  private playerY = DEFAULT_GROUND_Y;
  private vy = 0;
  private onGround = true;
  private holding = false;
  private holdUntil = 0;
  private jumpQueuedUntil = 0;
  private invulnUntil = 0;

  private obstacles: Mover[] = [];
  private collectibles: Mover[] = [];
  private decor: Mover[] = [];

  private elapsed = 0;
  private stageIndex = -1;
  private nextObstacle = 1700;
  private nextCollectible = 800;
  private nextDecor = 500;
  private nextBackDecor = 700;
  private paused = false;

  private hearts = 3;
  private score = 0;
  private stageCollects = 0;
  private kayaFound = 0;
  private kaya?: Phaser.GameObjects.Image;
  private kayaCover?: Phaser.GameObjects.Image;
  private kayaPawTaken = new Set<number>();
  private kayaHintShown = false;

  private heartText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private pawText!: Phaser.GameObjects.Text;
  private stageTitle!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private revealText!: Phaser.GameObjects.Text;
  private revealPanel!: Phaser.GameObjects.Graphics;
  private toast!: Phaser.GameObjects.Text;
  private bg!: Phaser.GameObjects.Image;
  private rain?: Phaser.GameObjects.Particles.ParticleEmitter;
  private petals?: Phaser.GameObjects.Particles.ParticleEmitter;
  private warm?: Phaser.GameObjects.Image[];
  private pauseLayer?: Phaser.GameObjects.Container;

  constructor() {
    super('RunnerScene');
  }

  create() {
    this.resetState();
    this.bg = addSceneBackground(this, bgKeyFor(LEVELS[0].background));
    addGroundBand(this);

    this.anims.create({
      key: 'run',
      frames: [{ key: 'groom-run-1' }, { key: 'groom-run-2' }, { key: 'groom-run-3' }, { key: 'groom-run-4' }],
      frameRate: 11,
      repeat: -1,
    });

    this.player = this.add.sprite(PLAYER_X, this.groundY, 'groom-run-1').setOrigin(0.5, 1).setDepth(8);
    scaleTo(this.player, PLAYER_H);
    this.player.play('run');

    this.buildHud();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p));
    this.input.on('pointerup', () => (this.holding = false));

    // Keyboard for desktop play: Space / ↑ / W jump (hold to jump higher, same as
    // tap-and-hold); Esc / P toggle pause. addCapture stops Space/arrows scrolling
    // the page. Ignore auto-repeat so a held key doesn't machine-gun jump requests.
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture(['SPACE', 'UP', 'DOWN', 'W']);
      const onJumpKey = (e: KeyboardEvent) => {
        if (!e.repeat) this.requestJump();
      };
      kb.on('keydown-SPACE', onJumpKey);
      kb.on('keydown-UP', onJumpKey);
      kb.on('keydown-W', onJumpKey);
      const releaseHold = () => (this.holding = false);
      kb.on('keyup-SPACE', releaseHold);
      kb.on('keyup-UP', releaseHold);
      kb.on('keyup-W', releaseHold);
      kb.on('keydown-ESC', () => this.togglePause());
      kb.on('keydown-P', () => this.togglePause());
      kb.on('keydown-ENTER', () => {
        if (this.paused) this.togglePause(); // Enter resumes from the pause menu
      });
    }

    // dev preview: #runner2 / #runner3 jump straight to a level
    const m = window.location.hash.match(/#runner([123])/);
    const startStage = m ? parseInt(m[1], 10) - 1 : 0;
    this.elapsed = startStage * STAGE_MS + 200;
    this.setStage(startStage);
  }

  private resetState() {
    this.groundY = DEFAULT_GROUND_Y;
    this.playerY = DEFAULT_GROUND_Y;
    this.vy = 0;
    this.onGround = true;
    this.holding = false;
    this.jumpQueuedUntil = 0;
    this.invulnUntil = 0;
    this.obstacles = [];
    this.collectibles = [];
    this.decor = [];
    this.elapsed = 0;
    this.stageIndex = -1;
    this.nextObstacle = 1700;
    this.nextCollectible = 800;
    this.nextDecor = 500;
    this.nextBackDecor = 700;
    this.paused = false;
    this.hearts = 3;
    this.score = 0;
    this.stageCollects = 0;
    this.kayaFound = 0;
    this.registry.set('kayaFound', 0);
    this.kaya = undefined;
    this.kayaCover = undefined;
    this.kayaPawTaken = new Set();
    this.kayaHintShown = false;
    // scene instances are reused across replays — drop stale refs to destroyed emitters
    this.rain = undefined;
    this.petals = undefined;
    this.warm = undefined;
  }

  /* ---- HUD ---- */
  private buildHud() {
    const compact = isCompactViewport();
    const panelH = compact ? 42 : 46;
    const panel = pixelPanel(this, GAME_WIDTH / 2, 34, compact ? 300 : 316, panelH, { depth: 20 });
    const iconY = 34;
    const hud = { fontFamily: FONT_PIXEL, fontSize: compact ? '10px' : '11px', color: T_CREAM };
    const heartIcon = this.add.image(58, iconY, 'ui-heart').setDepth(21).setDisplaySize(20, 22);
    this.heartText = this.add.text(76, iconY, 'x3', hud).setOrigin(0, 0.5).setDepth(21);
    const sparkleIcon = scaleTo(this.add.image(136, iconY, 'fx/sparkle-1').setDepth(21), 22);
    this.progressText = this.add.text(152, iconY, '×0', hud).setOrigin(0, 0.5).setDepth(21);
    const pawIcon = scaleTo(this.add.image(210, iconY, 'paw-icon').setDepth(21), 18);
    this.pawText = this.add.text(226, iconY, '0/3', hud).setOrigin(0, 0.5).setDepth(21);

    const pauseBtn = pixelButton(this, 330, 34, compact ? 42 : 46, compact ? 34 : 38, 'II', 'secondary', () => this.togglePause(), compact ? 12 : 13);
    const soundBtn = pixelButton(this, 284, 34, compact ? 34 : 36, compact ? 34 : 38, '♪', 'secondary', () => {
      const muted = sfx.toggle();
      soundBtn.setAlpha(muted ? 0.45 : 1);
    }, compact ? 14 : 16);
    soundBtn.setAlpha(sfx.isMuted() ? 0.45 : 1);
    const skipH = compact ? 38 : 42;
    const skipBtn = pixelButton(this, GAME_WIDTH / 2, RUNNER_SKIP_Y, compact ? 240 : 268, skipH, 'Пропустить игру', 'secondary', () => {
      track('skip', { from: `stage_${this.stageIndex + 1}` });
      this.scene.start('FinaleScene');
    }, compact ? 12 : 13);

    this.stageTitle = this.add
      .text(GAME_WIDTH / 2, compact ? 82 : 82, '', { fontFamily: FONT_PIXEL, fontSize: compact ? '10px' : '11px', color: T_GOLD, align: 'center', lineSpacing: compact ? 3 : 2 })
      .setOrigin(0.5)
      .setDepth(20);
    this.objectiveText = this.add
      .text(GAME_WIDTH / 2, compact ? 122 : 122, '', { fontFamily: FONT_BODY, fontSize: compact ? '13px' : '14px', color: T_CREAM, align: 'center' })
      .setOrigin(0.5)
      .setDepth(20);
    this.revealPanel = pixelPanel(this, GAME_WIDTH / 2, compact ? 160 : 158, compact ? 304 : 332, compact ? 84 : 96, { depth: 19 }).setVisible(false);
    this.revealText = this.add
      .text(GAME_WIDTH / 2, compact ? 160 : 158, '', {
        fontFamily: FONT_BODY,
        fontSize: compact ? '12px' : '14px',
        color: T_CREAM,
        align: 'center',
        lineSpacing: compact ? 2 : 3,
        wordWrap: { width: compact ? 262 : 286, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    this.toast = this.add
      .text(GAME_WIDTH / 2, 286, '', {
        fontFamily: FONT_BODY,
        fontSize: '15px',
        color: T_GOLD,
        align: 'center',
        lineSpacing: 3,
        backgroundColor: '#0b1120cc',
        padding: { x: 14, y: 9 },
      })
      .setOrigin(0.5)
      .setDepth(25)
      .setVisible(false);

    frameRunner(
      this,
      // includes revealText so the stage-start schedule panel (drawn at revealText.y
      // via sizeRevealPanel) shifts down with the level title instead of overlapping it
      [panel, heartIcon, this.heartText, sparkleIcon, this.progressText, pawIcon, this.pawText, pauseBtn, soundBtn, this.stageTitle, this.objectiveText, this.revealText].map(shiftItem),
      34 - panelH / 2,
      [shiftItem(skipBtn)],
      RUNNER_SKIP_Y + skipH / 2,
    );

    this.updateHud();
  }

  private updateHud() {
    this.heartText.setText(`×${this.hearts}`);
    this.progressText.setText(this.stageIndex === 0 ? `${Math.min(this.stageCollects, LEVEL_COLLECT_GOAL)}/${LEVEL_COLLECT_GOAL}` : `×${this.score}`);
    this.pawText.setText(`${this.kayaFound}/3`);
  }

  private updateObjective() {
    if (!this.objectiveText || this.stageIndex < 0) return;
    if (this.stageIndex === 0) {
      const collected = Math.min(this.stageCollects, LEVEL_COLLECT_GOAL);
      this.objectiveText.setText(collected >= 3 ? `Готово: ${collected}/${LEVEL_COLLECT_GOAL}` : `Собери 3/5 предметов · ${collected}/${LEVEL_COLLECT_GOAL}`);
      return;
    }
    if (this.stageIndex === 1) {
      this.objectiveText.setText(`Сердца держатся: ${this.hearts}/3`);
      return;
    }
    const stageElapsed = Math.max(0, this.elapsed - STAGE_MS * 2);
    const left = Math.max(0, 100 - Math.round((stageElapsed / STAGE_MS) * 100));
    this.objectiveText.setText(left <= 0 ? 'Арка совсем рядом' : `До арки: ${left}%`);
  }

  /* ---- input ---- */
  private onTap(p: Phaser.Input.Pointer) {
    if (this.paused) return;
    if (this.kaya?.active) {
      const b = this.kaya.getBounds();
      const pad = 18; // forgiving tap target for the small, moving cat
      if (p.x >= b.x - pad && p.x <= b.right + pad && p.y >= b.y - pad && p.y <= b.bottom + pad) {
        this.findKaya();
        return;
      }
    }
    if (p.y < HUD_GUARD_Y) return;
    this.requestJump();
  }

  /* Jump buffer: remember a jump press for a short window and fire it the moment
     the player is grounded. A tap landing just before touchdown still jumps,
     instead of being silently dropped (which read as unresponsive controls). */
  private requestJump() {
    if (this.paused) return;
    this.jumpQueuedUntil = this.time.now + 130;
    this.tryJump();
  }

  private tryJump() {
    if (this.onGround && this.time.now <= this.jumpQueuedUntil) {
      this.jumpQueuedUntil = 0;
      this.jump();
    }
  }

  private jump() {
    if (!this.onGround) return;
    this.vy = JUMP_V;
    this.onGround = false;
    this.holding = true;
    this.holdUntil = this.time.now + 220;
    this.player.anims.stop();
    this.player.setTexture('groom-jump');
    this.spawnFx('dust', PLAYER_X - 8, this.groundY, 52);
    sfx.jump();
  }

  /* ---- stages ---- */
  private setStage(index: number) {
    const isTransition = this.stageIndex >= 0; // a real location change, not the first stage
    this.clearMovers(); // no cross-level bleed (e.g. a car drifting into the embankment)
    this.stageIndex = index;
    this.stageCollects = 0;
    const level = LEVELS[index];
    const meta = stageMeta[index];
    this.groundY = level.groundY ?? DEFAULT_GROUND_Y;
    this.playerY = this.groundY;
    this.player.y = this.playerY;
    track('stage_start', { stage: index + 1 });

    this.bg.setTexture(bgKeyFor(level.background));
    refitBackground(this, this.bg, {
      groundY: this.groundY,
      zoom: level.backgroundZoom ?? 1,
      offsetY: (level as { backgroundOffsetY?: number }).backgroundOffsetY ?? 0,
    });
    const tint = hexTint(level.tint);
    if (tint !== undefined) this.bg.setTint(tint);
    else this.bg.clearTint();

    // soft flash smooths the abrupt switch to a new location
    if (isTransition && !prefersReducedMotion()) this.cameras.main.flash(320, 248, 242, 228);

    // rain overlay
    if (level.rain && !this.rain && !prefersReducedMotion()) {
      this.rain = this.add
        .particles(0, -20, 'fx/raindrop', {
          x: { min: -40, max: GAME_WIDTH + 80 },
          y: -20,
          lifespan: 760,
          speedY: { min: 720, max: 920 },
          speedX: { min: -200, max: -150 },
          scaleY: { min: 0.8, max: 1.5 },
          alpha: { start: 0.55, end: 0.18 },
          quantity: 3,
          frequency: 26,
        })
        .setDepth(11);
    } else if (!level.rain && this.rain) {
      this.rain.destroy();
      this.rain = undefined;
    }

    // drifting cherry petals on the romantic final stretch
    const wantPetals = index === 2 && !prefersReducedMotion();
    if (wantPetals && !this.petals) {
      this.petals = makePetalEmitter(this).setDepth(10);
    } else if (!wantPetals && this.petals) {
      this.petals.destroy();
      this.petals = undefined;
    }

    // warm, cosy interior light for the "getting ready" room (level 1)
    const wantWarm = index === 0;
    if (wantWarm && !this.warm) {
      this.warm = this.makeWarmLight();
    } else if (!wantWarm && this.warm) {
      this.warm.forEach((o) => o.destroy());
      this.warm = undefined;
    }

    this.stageTitle.setText(`УРОВЕНЬ ${index + 1}\n${meta.title.toUpperCase()}`);
    this.objectiveText.setText(meta.objective);
    this.revealText.setText([meta.subtitle, ...meta.reveal].join('\n'));
    sizeRevealPanel(this.revealPanel, this.revealText);
    this.stageTitle.setAlpha(0);
    this.objectiveText.setAlpha(0);
    this.revealPanel.setVisible(true).setAlpha(0);
    this.revealText.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: [this.stageTitle, this.revealPanel, this.revealText], alpha: 1, duration: 260 });
    const stageAtReveal = index;
    this.time.delayedCall(4300, () => {
      this.tweens.add({
        targets: [this.revealPanel, this.revealText],
        alpha: 0,
        duration: 400,
        onComplete: () => {
          this.revealPanel.setVisible(false);
          this.revealText.setVisible(false);
          if (this.stageIndex === stageAtReveal) this.tweens.add({ targets: this.objectiveText, alpha: 1, duration: 260 });
        },
      });
    });

    this.kaya?.destroy();
    this.kayaCover?.destroy();
    this.kaya = undefined;
    this.kayaCover = undefined;
    this.scheduleKaya();
    this.updateHud();
    this.updateObjective();

    this.placeOpeningDecor(level, index);
    this.nextDecor = 1400;
    this.nextBackDecor = 600;
    // grace period: let the player take in each new location before obstacles arrive
    this.nextObstacle = 3400;
  }

  /* soft warm light pools that give the room depth and cosiness */
  private makeWarmLight(): Phaser.GameObjects.Image[] {
    const spots: Array<{ x: number; y: number; size: number; alpha: number }> = [
      { x: 96, y: 168, size: 300, alpha: 0.16 },
      { x: 300, y: 232, size: 260, alpha: 0.14 },
      { x: PLAYER_X + 30, y: this.groundY - 120, size: 240, alpha: 0.12 },
    ];
    return spots.map((s) => {
      const g = this.add
        .image(s.x, s.y, 'fx/glow')
        .setDepth(2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffc98a)
        .setDisplaySize(s.size, s.size)
        .setAlpha(s.alpha);
      ambientLoop(this, { targets: g, alpha: s.alpha + 0.06, yoyo: true, repeat: -1, duration: 2200, ease: 'Sine.easeInOut' });
      return g;
    });
  }

  /* dim, slower-scrolling wall pieces behind the main decor → parallax depth (level 1) */
  private spawnBackDecor() {
    const keys = ['furniture/painting', 'furniture/photo-frame', 'furniture/sconce', 'furniture/shelf'];
    const key = Phaser.Utils.Array.GetRandom(keys) as string;
    const h = Phaser.Math.Between(56, 78);
    const y = this.groundY - Phaser.Math.Between(150, 232);
    const sprite = this.add.image(GAME_WIDTH + 80, y, key).setOrigin(0.5, 0.5).setDepth(2).setTint(0x8f9bbd).setAlpha(0);
    scaleTo(sprite, h);
    this.tweens.add({ targets: sprite, alpha: 0.7, duration: 240 });
    this.decor.push({ obj: sprite, vx: -SPEED * 0.45 });
  }

  private placeOpeningDecor(level: LevelConfig, index: number) {
    const opening: Record<number, Array<{ key: string; x: number }>> = {
      0: [
        { key: 'furniture/wardrobe', x: 36 },
        { key: 'furniture/sconce', x: 176 },
        { key: 'furniture/painting', x: 266 },
        { key: 'furniture/plant', x: 330 },
        { key: 'furniture/candle', x: 226 },
      ],
      1: [
        { key: 'decor/lamp-post', x: 40 },
      ],
      2: [
        { key: 'decor/flower-box', x: 42 },
        { key: 'decor/sign-arrow', x: 318 },
        { key: 'decor/lamp-post', x: 212 },
      ],
    };
    const byKey = new Map(level.decor.map((entry) => [entry.key, entry]));
    const placed = new Set<string>();
    opening[index]?.forEach(({ key, x }) => {
      const entry = byKey.get(key);
      if (!entry) return;
      placed.add(key);
      this.spawnDecorEntry(entry, x);
    });
    const extras = Phaser.Utils.Array.Shuffle(level.decor.filter((entry) => !placed.has(entry.key))).slice(0, index === 0 ? 2 : 1);
    extras.forEach((entry, i) => this.spawnDecorEntry(entry, 190 + i * 94));
  }

  /* Phaser doesn't auto-remove tweens when a target is destroyed, so the looping
     ambient tweens (sway / glow pulse / cloud bob) would keep ticking on dead
     objects after culling — wasted work that piles up over a run. Kill them first. */
  private killMoverTweens(m: Mover) {
    this.tweens.killTweensOf(m.obj);
    if (m.glow) this.tweens.killTweensOf(m.glow);
  }

  private clearMovers() {
    [...this.decor, ...this.obstacles, ...this.collectibles].forEach((m) => {
      this.killMoverTweens(m);
      m.glow?.destroy();
      if (m.obj.active) m.obj.destroy();
    });
    this.decor = [];
    this.obstacles = [];
    this.collectibles = [];
  }

  /* schedule Kaya to drift in from the right; retries through the stage until found */
  private scheduleKaya() {
    if (this.kayaPawTaken.has(this.stageIndex)) return;
    const stage = this.stageIndex;
    this.time.delayedCall(Phaser.Math.Between(2400, 4200), () => {
      if (this.stageIndex !== stage || this.kayaPawTaken.has(stage) || this.kaya) return;
      this.spawnKaya();
    });
  }

  private spawnKaya() {
    const k = LEVELS[this.stageIndex].kaya;
    const spot = KAYA_SPOTS[this.stageIndex] ?? KAYA_SPOTS[0];
    const baseX = GAME_WIDTH + 90;
    this.kayaCover = this.add.image(baseX, this.groundY, spot.cover).setOrigin(0.5, 1).setDepth(7);
    scaleTo(this.kayaCover, spot.coverH);
    this.kaya = this.add.image(baseX + spot.dx, this.groundY, k.texture).setOrigin(0.5, 1).setDepth(6);
    scaleTo(this.kaya, k.h);
    this.kaya.setInteractive({ useHandCursor: true });
    // First time Kaya appears, tell the player what to do — she's small and easy
    // to miss, and tapping her (not jumping) is a non-obvious second mechanic.
    if (!this.kayaHintShown) {
      this.kayaHintShown = true;
      this.showToast('Кая спряталась рядом 🐾\nТапни по ней, чтобы найти', 2800);
    }
  }

  private scrollKaya(dt: number) {
    const d = SPEED * dt;
    if (this.kaya?.active) {
      this.kaya.x -= d;
      if (this.kayaCover?.active) this.kayaCover.x -= d;
      if (this.kaya.x < -120) {
        // drifted past untapped — clean up and offer another chance later this stage
        this.kaya.destroy();
        this.kayaCover?.destroy();
        this.kaya = undefined;
        this.kayaCover = undefined;
        this.scheduleKaya();
      }
    } else if (this.kayaCover?.active) {
      // Kaya was found; let her cover slide out with the world
      this.kayaCover.x -= d;
      if (this.kayaCover.x < -120) {
        this.kayaCover.destroy();
        this.kayaCover = undefined;
      }
    }
  }

  private findKaya() {
    if (this.kayaPawTaken.has(this.stageIndex)) return;
    this.kayaPawTaken.add(this.stageIndex);
    this.kayaFound += 1;
    track('kaya_found', { count: this.kayaFound, stage: this.stageIndex + 1 });
    this.updateHud();
    const target = this.kaya;
    if (target) {
      this.spawnFx('heart', target.x, target.y - target.displayHeight * 0.6, 84);
      this.tweens.add({ targets: target, y: target.y - 26, alpha: 0, scale: target.scale * 1.3, duration: 320, onComplete: () => target.destroy() });
    }
    this.kaya = undefined;
    if (this.kayaFound >= 3) this.showToast('Кая одобрила твоё приглашение.\nТеперь ты в списке любимых гостей.', 3600);
    else this.showToast(`Кая найдена · ${this.kayaFound}/3`, 1500);
    this.registry.set('kayaFound', this.kayaFound);
  }

  private showToast(text: string, ms: number) {
    this.toast.setText(text).setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.toast, alpha: 1, duration: 220 });
    this.time.delayedCall(ms, () => {
      this.tweens.add({ targets: this.toast, alpha: 0, duration: 360, onComplete: () => this.toast.setVisible(false) });
    });
  }

  /* ---- spawning ---- */
  private spawnDecor(atX = GAME_WIDTH + 160) {
    const level = LEVELS[this.stageIndex] ?? LEVELS[0];
    if (level.decor.length === 0) return;
    this.spawnDecorEntry(Phaser.Utils.Array.GetRandom(level.decor) as DecorEntry, atX);
  }

  private spawnDecorEntry(entry: DecorEntry, atX: number) {
    const baseY = this.groundY - (entry.yOffset ?? 0);
    const sprite = this.add.image(atX, baseY, entry.key).setOrigin(0.5, 1).setDepth(4);
    scaleTo(sprite, entry.h);
    const revealWhenInside = atX > GAME_WIDTH;
    if (revealWhenInside) sprite.setAlpha(0);
    else keepInside(sprite, 6);
    this.decor.push({ obj: sprite, vx: -SPEED, revealWhenInside });
    if (entry.glow) {
      const isLamp = entry.key.includes('lamp');
      const top = baseY - entry.h;
      const glowY = isLamp ? top + entry.h * 0.16 : baseY - entry.h * 0.5;
      // lamps get a tighter, softer halo — a big ADD-blend ball blooms too hard on the dark level 2
      const size = entry.h * (isLamp ? 0.6 : 1.05);
      const baseA = isLamp ? 0.24 : 0.42;
      const peakA = isLamp ? 0.38 : 0.6;
      const glow = this.add.image(sprite.x, glowY, 'fx/glow').setDepth(3).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffcf8a);
      glow.setDisplaySize(size, size).setAlpha(revealWhenInside ? 0 : baseA);
      ambientLoop(this, { targets: glow, alpha: peakA, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut' });
      this.decor.push({ obj: glow, vx: -SPEED, revealWhenInside });
    }
  }

  private spawnCollectible() {
    const level = LEVELS[this.stageIndex] ?? LEVELS[0];
    const key = Phaser.Utils.Array.GetRandom(level.collectibles) as string;
    const y = Phaser.Math.Between(this.groundY - 176, this.groundY - 86);
    const img = this.add.image(GAME_WIDTH + 46, y, key).setDepth(7);
    scaleToMax(img, COLLECTIBLE_SIZE[key] ?? COLLECTIBLE_H);
    img.x = GAME_WIDTH + img.displayWidth / 2 + 18;
    img.setAlpha(0);
    // soft halo + gentle sway make pickups read as collectible treasures.
    // dark levels (rain/dusk) bloom harder under ADD blend → tighter, dimmer halo there
    const dark = this.stageIndex >= 1;
    const halo = Math.max(img.displayWidth, img.displayHeight) * (dark ? 1.55 : 1.8);
    const glow = this.add
      .image(img.x, y, 'fx/glow')
      .setDepth(6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff0bf)
      .setDisplaySize(halo, halo)
      .setAlpha(0);
    ambientLoop(this, { targets: glow, alpha: dark ? 0.32 : 0.55, yoyo: true, repeat: -1, duration: 820, ease: 'Sine.easeInOut' });
    ambientLoop(this, { targets: img, angle: 7, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.easeInOut' });
    this.collectibles.push({ obj: img, vx: -SPEED, revealWhenInside: true, glow });
  }

  private spawnObstacle() {
    const level = LEVELS[this.stageIndex] ?? LEVELS[0];
    if (level.obstacles.length === 0) return;
    const entry = Phaser.Utils.Array.GetRandom(level.obstacles) as ObstacleEntry;
    const air = entry.air !== undefined;
    const y = air ? this.groundY - entry.air! : this.groundY;
    const img = this.add.image(GAME_WIDTH + 70, y, entry.key).setOrigin(0.5, air ? 0.5 : 1).setDepth(7);
    scaleTo(img, entry.h);
    img.x = GAME_WIDTH + img.displayWidth / 2 + 24;
    img.setAlpha(0);
    // Floating air obstacles (clouds) bob to read as airborne, not static. Bob only
    // *upward* from the spawn line so the lowest point never drops below rest — the
    // "run under it, don't jump" path stays exactly as safe as before. tryHit reads
    // the live y each frame, so the hitbox follows the bob for free. moveAndCull
    // only drives x, so this y-tween doesn't fight it.
    if (air) ambientLoop(this, { targets: img, y: y - 18, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.easeInOut' });
    this.obstacles.push({ obj: img, vx: -(SPEED + 12 + this.stageIndex * 8), cloud: air, revealWhenInside: true });
  }

  private spawnFx(kind: 'sparkle' | 'heart' | 'dust', x: number, y: number, h: number) {
    const fx = this.add.sprite(x, y, `fx/${kind}-1`).setDepth(26);
    fx.setScale(h / fx.height);
    fx.play(`fx-${kind}`);
    fx.once('animationcomplete', () => fx.destroy());
    if (kind !== 'dust') this.tweens.add({ targets: fx, y: y - 22, duration: 460 });
  }

  /* ---- pause ---- */
  private togglePause() {
    if (this.pauseLayer) {
      this.pauseLayer.destroy();
      this.pauseLayer = undefined;
      this.paused = false;
      // resume scene timers + in-flight tweens frozen on pause
      this.time.paused = false;
      this.tweens.resumeAll();
      track('resume', { stage: this.stageIndex + 1 });
      return;
    }
    this.paused = true;
    // update() bails on `paused`, but delayedCalls (Kaya spawn, reveal/toast
    // auto-hide, blink) and tweens run on the scene clock — freeze them too so
    // nothing fires or animates behind the pause overlay. pauseAll() only touches
    // tweens that exist now, so the pause menu's own button-press tween still plays.
    this.time.paused = true;
    this.tweens.pauseAll();
    track('pause', { stage: this.stageIndex + 1 });
    const shade = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b1120, 0.72);
    const panel = makeGraphicsPanel(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 318, 218);
    const label = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 66, 'ПАУЗА', { fontFamily: FONT_PIXEL, fontSize: '18px', color: T_GOLD }).setOrigin(0.5);
    const resume = pixelButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 2, 248, 50, 'Продолжить', 'primary', () => this.togglePause(), 17);
    const skip = pixelButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 58, 248, 44, 'Пропустить игру', 'secondary', () => {
      track('skip', { from: 'pause' });
      this.scene.start('FinaleScene');
    }, 13);
    this.pauseLayer = this.add.container(0, 0, [shade, panel, label, resume, skip]).setDepth(40);
  }

  /* ---- main loop ---- */
  update(_time: number, delta: number) {
    if (this.paused) return;
    const step = Math.min(delta, 50);
    const dt = step / 1000;
    this.elapsed += step;

    const stage = Math.min(2, Math.floor(this.elapsed / STAGE_MS));
    if (stage !== this.stageIndex) this.setStage(stage);

    // player vertical motion
    this.vy += GRAVITY * dt;
    if (this.holding && this.vy < 0 && this.time.now < this.holdUntil) this.vy -= HOLD_LIFT * dt;
    this.playerY += this.vy * dt;
    if (this.playerY >= this.groundY) {
      this.playerY = this.groundY;
      this.vy = 0;
      if (!this.onGround) {
        this.onGround = true;
        this.player.play('run', true);
        this.spawnFx('dust', PLAYER_X - 4, this.groundY, 48);
        // Bunny-hop: if the jump input is still held on touchdown, chain straight
        // into another hop so a held tap flows over a run of obstacles. Release to
        // land and run (needed to pass under the airborne cloud obstacles).
        if (this.holding) this.jump();
      }
    } else {
      this.onGround = false;
      this.player.setTexture(this.vy < 0 ? 'groom-jump' : 'groom-land');
    }
    this.player.y = this.playerY;
    this.tryJump(); // consume a buffered jump the frame we touch down
    this.player.setAlpha(this.time.now < this.invulnUntil && Math.floor(this.time.now / 80) % 2 ? 0.4 : 1);

    // spawn timers
    this.nextDecor -= step;
    this.nextCollectible -= step;
    this.nextObstacle -= step;
    this.nextBackDecor -= step;
    if (this.nextDecor <= 0) {
      this.spawnDecor();
      this.nextDecor = Phaser.Math.Between(2200, 3800);
    }
    if (this.nextCollectible <= 0) {
      this.spawnCollectible();
      // the first level is about gathering — pickups come a bit more often
      this.nextCollectible = this.stageIndex === 0 ? Phaser.Math.Between(820, 1240) : Phaser.Math.Between(1100, 1700);
    }
    if (this.nextObstacle <= 0) {
      this.spawnObstacle();
      this.nextObstacle = Phaser.Math.Between(1600, 2500);
    }
    if (this.nextBackDecor <= 0) {
      if (this.stageIndex === 0) this.spawnBackDecor();
      this.nextBackDecor = Phaser.Math.Between(2400, 3600);
    }

    this.moveAndCull(this.decor, dt);
    this.moveAndCull(this.collectibles, dt, (m) => this.tryCollect(m));
    this.moveAndCull(this.obstacles, dt, (m) => this.tryHit(m));
    this.scrollKaya(dt);
    if (this.stageIndex === 2) this.updateObjective();

    if (this.elapsed >= STAGE_MS * 3 + FINISH_PAD_MS) this.scene.start('FinaleScene');
  }

  private moveAndCull(list: Mover[], dt: number, onCheck?: (m: Mover) => void) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (!m.obj.active) {
        list.splice(i, 1);
        continue;
      }
      m.obj.x += m.vx * dt;
      if (m.glow) {
        m.glow.x = m.obj.x;
        m.glow.y = m.obj.y;
      }
      if (m.revealWhenInside && m.obj.alpha === 0 && m.obj.x + m.obj.displayWidth / 2 < GAME_WIDTH - 4) {
        this.tweens.add({ targets: m.obj, alpha: 1, duration: 120 });
      }
      if (onCheck) onCheck(m);
      if (m.obj.x < -200) {
        this.killMoverTweens(m);
        m.glow?.destroy();
        m.obj.destroy();
        list.splice(i, 1);
      }
    }
  }

  private playerBox() {
    return new Phaser.Geom.Rectangle(PLAYER_X - 16, this.playerY - PLAYER_H * 0.76, 32, PLAYER_H * 0.76);
  }

  private tryCollect(m: Mover) {
    const o = m.obj;
    const box = new Phaser.Geom.Rectangle(o.x - o.displayWidth * 0.32, o.y - o.displayHeight * 0.32, o.displayWidth * 0.64, o.displayHeight * 0.64);
    if (Phaser.Geom.Intersects.RectangleToRectangle(this.playerBox(), box)) {
      this.score += 1;
      this.stageCollects += 1;
      this.updateHud();
      this.updateObjective();
      if (this.stageIndex === 0 && this.stageCollects === 3) this.showToast('Главное собрано!', 1300);
      sfx.collect();
      this.spawnFx('sparkle', o.x, o.y, 62);
      this.killMoverTweens(m); // stop the looping sway/glow before the one-shot collect tween
      m.glow?.destroy();
      this.tweens.add({ targets: o, y: o.y - 30, alpha: 0, scale: o.scale * 1.4, duration: 260, onComplete: () => o.destroy() });
      o.setActive(false);
      m.hit = true;
    }
  }

  private tryHit(m: Mover) {
    if (m.hit || this.time.now < this.invulnUntil) return;
    const o = m.obj;
    // Cap hitbox width relative to height so very wide obstacles (the car is
    // ~2.7:1 → ~160px at h=60) don't get an unclearable box: a tap-jump can't
    // stay airborne long enough to pass an 80px-wide box. Tall/narrow obstacles
    // (traffic light, bollard) are unaffected since their width is already small.
    const w = Math.min(o.displayWidth * 0.5, o.displayHeight * 0.7);
    const h = o.displayHeight * (m.cloud ? 0.5 : 0.6);
    const cy = o.y - o.displayHeight * 0.5;
    const box = new Phaser.Geom.Rectangle(o.x - w / 2, cy - h / 2, w, h);
    if (Phaser.Geom.Intersects.RectangleToRectangle(this.playerBox(), box)) {
      m.hit = true;
      sfx.hit();
      if (this.hearts <= 1) {
        this.hearts = 1;
        this.showToast('Ничего, до свадьбы\nещё доберёшься', 1500);
      } else {
        this.hearts -= 1;
      }
      this.invulnUntil = this.time.now + 950;
      this.updateHud();
      this.updateObjective();
      this.cameras.main.shake(120, 0.006);
      o.setTint(0xffb1b1);
      this.time.delayedCall(260, () => o.active && o.clearTint());
    }
  }
}

/* ------------------------------------------------------------------ */
/* Finale                                                             */
/* ------------------------------------------------------------------ */
class FinaleScene extends Phaser.Scene {
  constructor() {
    super('FinaleScene');
  }

  create() {
    addSceneBackground(this, 'bg-finale');
    addGroundBand(this, 454);
    if (!prefersReducedMotion()) makePetalEmitter(this).setDepth(5);
    sfx.win();
    track('finish', { kayaFound: (this.registry.get('kayaFound') as number | undefined) ?? 0 });
    this.add.image(GAME_WIDTH / 2, 558, 'fx/glow').setDepth(4).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffcfb0).setDisplaySize(348, 348).setAlpha(0.46);
    // couple are the hero of the payoff — large, on the warm stone floor of the arch
    scaleTo(this.add.image(GAME_WIDTH / 2, 662, 'couple-pose').setOrigin(0.5, 1).setDepth(6), 198);

    const title = titleText(this, GAME_WIDTH / 2, 42, 'ТЫ ДОБРАЛСЯ!', 21, true);

    const descPanel = pixelPanel(this, GAME_WIDTH / 2, 108, 336, 82, { depth: 18 });
    const descText = this.add
      .text(GAME_WIDTH / 2, 108, 'А это значит, что ты\nприглашён на нашу свадьбу.', {
        fontFamily: FONT_BODY,
        fontSize: '16px',
        color: T_CREAM,
        align: 'center',
        lineSpacing: 4,
      })
      .setOrigin(0.5)
      .setDepth(20);
    const pinned: Pinned[] = [title, descPanel, descText];

    const kayaFound = (this.registry.get('kayaFound') as number | undefined) ?? 0;
    if (kayaFound >= 3) {
      const pawPanel = pixelPanel(this, GAME_WIDTH / 2, 162, 252, 38, { depth: 18, alpha: 0.9 });
      const pawIcon = scaleTo(this.add.image(GAME_WIDTH / 2 - 100, 162, 'paw-icon').setDepth(20), 16);
      const pawCaption = this.add
        .text(GAME_WIDTH / 2 + 12, 162, 'Кая одобрила приглашение', {
          fontFamily: FONT_BODY,
          fontSize: '13px',
          color: T_GOLD,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(20);
      const kaya = scaleTo(this.add.image(272, 664, 'kaya-sit').setOrigin(0.5, 1).setDepth(7), 54);
      this.idleKaya(kaya);
      pinned.push(pawPanel, pawIcon, pawCaption);
    }

    // plain caption (no panel) like the intro subtitle; a soft shadow keeps it legible over the floor
    this.add
      .text(GAME_WIDTH / 2, 706, 'Дата, маршрут, дресс-код\nи анкета — внутри.', {
        fontFamily: FONT_BODY,
        fontSize: '14px',
        color: T_GOLD,
        align: 'center',
        lineSpacing: 3,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setShadow(0, 2, '#0b1120', 5, false, true);
    const invite = pixelButton(this, GAME_WIDTH / 2, 762, 326, 52, 'Открыть приглашение', 'primary', () => openLanding('Открыть приглашение'), 16).setAlpha(0);
    const replay = pixelButton(this, GAME_WIDTH / 2, 816, 196, 34, 'Сыграть ещё раз', 'secondary', () => {
      track('replay');
      this.registry.set('kayaFound', 0);
      this.scene.start('IntroScene');
    }, 11).setAlpha(0);
    this.time.delayedCall(520, () => {
      this.tweens.add({ targets: invite, alpha: 1, y: invite.y - 4, duration: 280, ease: 'Sine.easeOut' });
    });
    this.time.delayedCall(760, () => {
      this.tweens.add({ targets: replay, alpha: 0.8, y: replay.y - 3, duration: 260, ease: 'Sine.easeOut' });
    });

    // keyboard players can't tab to the canvas buttons → Enter / Space opens the invite
    this.input.keyboard?.addCapture(['SPACE', 'ENTER']); // don't let Space scroll the page
    this.input.keyboard?.on('keydown-ENTER', () => openLanding('Открыть приглашение'));
    this.input.keyboard?.on('keydown-SPACE', () => openLanding('Открыть приглашение'));

    // full-screen canvas → pin the heading below the island; the couple, caption and
    // buttons scroll up together so the buttons clear the toolbar (no overlap).
    frameStaticScene(this, pinned, 31, 816 + 34 / 2);

    // sparkles sit on the (now-shifted) heading panel — anchor to its current y and
    // pin them (scrollFactor 0) so they don't drift up with the heading shift / camera.
    this.spawnFinaleSparkles(88, descText.y - 32);
  }

  /* Kaya idle loop: mostly still, with the occasional blink. The blink frame shares
     the same body/anchor as the sit frame, so only the eyes appear to move. */
  private idleKaya(cat: Phaser.GameObjects.Image) {
    const set = (key: string, ms: number, then: () => void) => {
      this.time.delayedCall(ms, () => {
        if (!cat.active) return;
        cat.setTexture(key);
        then();
      });
    };
    const blink = (done: () => void) => {
      set('kaya-sit-blink', 0, () => set('kaya-sit', 130, () => {
        // ~1 in 3 blinks is a double blink
        if (Phaser.Math.Between(0, 2) === 0) set('kaya-sit-blink', 110, () => set('kaya-sit', 120, done));
        else done();
      }));
    };
    const loop = () => {
      this.time.delayedCall(Phaser.Math.Between(2200, 4200), () => {
        if (!cat.active) return;
        blink(loop);
      });
    };
    loop();
  }

  private spawnFinaleSparkles(startX: number, startY: number) {
    for (let i = 0; i < 6; i += 1) {
      this.time.delayedCall(i * 140, () => {
        const fx = this.add.sprite(startX + i * 42, startY + (i % 2) * 28, 'fx/sparkle-1').setDepth(26).setScale(0.42).setScrollFactor(0);
        fx.play('fx-sparkle');
        fx.once('animationcomplete', () => fx.destroy());
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function openLanding(label: string) {
  track('cta_click', { label });
  window.location.href = LANDING_URL;
}

function makePetalEmitter(scene: Phaser.Scene) {
  return scene.add.particles(0, -12, 'fx/petal', {
    x: { min: -20, max: GAME_WIDTH + 20 },
    y: -12,
    lifespan: 5600,
    speedX: { min: -80, max: -28 },
    speedY: { min: 42, max: 86 },
    scale: { min: 0.55, max: 1.1 },
    alpha: { start: 0.95, end: 0.45 },
    rotate: { start: 0, end: 240 },
    tint: [0xf3aec0, 0xf7c8d6, 0xe98aa6],
    quantity: 1,
    frequency: 300,
  });
}

function addGroundBand(_scene: Phaser.Scene, _y = DEFAULT_GROUND_Y) {
  // The portrait backgrounds already include a floor/embankment. Keep this as
  // a no-op so old scene setup calls do not draw an artificial platform.
}

function coverScale(scene: Phaser.Scene, key: string) {
  const tex = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  return { tex, scale: Math.max(GAME_WIDTH / tex.width, GAME_HEIGHT / tex.height) };
}

function addSceneBackground(scene: Phaser.Scene, key: string) {
  const bg = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, key).setDepth(0);
  const { tex, scale } = coverScale(scene, key);
  bg.setDisplaySize(tex.width * scale, tex.height * scale);
  scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0d1426, 0.12).setDepth(1);
  scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 46, GAME_WIDTH, 160, 0x0b1120, 0.18).setDepth(1);
  return bg;
}

function refitBackground(scene: Phaser.Scene, bg: Phaser.GameObjects.Image, opts: { groundY?: number; zoom?: number; offsetY?: number } = {}) {
  // Zoom in anchored to the canvas bottom: this raises the floor and crops the
  // empty upper wall/sky, so the action sits higher and the middle reads denser.
  // offsetY pushes the whole background down, lowering its floor line (and cropping
  // the dead wall at the very bottom) so it can match a lower groundY.
  const zoom = opts.zoom ?? 1;
  const offsetY = opts.offsetY ?? 0;
  const { tex, scale } = coverScale(scene, bg.texture.key);
  const dh = tex.height * scale * zoom;
  bg.setDisplaySize(tex.width * scale * zoom, dh);
  bg.setPosition(GAME_WIDTH / 2, GAME_HEIGHT - dh / 2 + offsetY);
}

function titleText(scene: Phaser.Scene, x: number, y: number, label: string, size: number, centered = false) {
  const t = scene.add
    .text(x, y, label, { fontFamily: FONT_PIXEL, fontSize: `${size}px`, color: '#fbe6cf' })
    .setDepth(22)
    .setStroke('#41301a', Math.max(4, Math.round(size * 0.2)))
    .setShadow(0, 4, '#0b1120', 5, true, true);
  if (centered) t.setOrigin(0.5);
  return t;
}

function notchPoints(l: number, t: number, w: number, h: number, c: number): Phaser.Geom.Point[] {
  const r = l + w;
  const b = t + h;
  return [
    new Phaser.Geom.Point(l + c, t),
    new Phaser.Geom.Point(r - c, t),
    new Phaser.Geom.Point(r, t + c),
    new Phaser.Geom.Point(r, b - c),
    new Phaser.Geom.Point(r - c, b),
    new Phaser.Geom.Point(l + c, b),
    new Phaser.Geom.Point(l, b - c),
    new Phaser.Geom.Point(l, t + c),
  ];
}

function fillNotch(g: Phaser.GameObjects.Graphics, l: number, t: number, w: number, h: number, c: number, color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillPoints(notchPoints(l, t, w, h, c), true);
}

function drawPanel(g: Phaser.GameObjects.Graphics, left: number, top: number, w: number, h: number, a = 1) {
  const c = Math.min(11, Math.floor(Math.min(w, h) / 4));
  fillNotch(g, left, top, w, h, c, C_NAVY_DARK, a);
  fillNotch(g, left + 3, top + 3, w - 6, h - 6, c - 1, C_GOLD, a);
  fillNotch(g, left + 6, top + 6, w - 12, h - 12, c - 2, C_NAVY, a);
  g.fillStyle(0x2c3e63, 0.55 * a).fillRect(left + 10, top + 8, w - 20, 2);
}

function pixelPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: { depth?: number; alpha?: number } = {}) {
  const g = scene.add.graphics().setDepth(opts.depth ?? 20);
  drawPanel(g, x - w / 2, y - h / 2, w, h, opts.alpha ?? 0.96);
  return g;
}

function makeGraphicsPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number) {
  const g = scene.add.graphics({ x, y });
  drawPanel(g, -w / 2, -h / 2, w, h, 1);
  return g;
}

function speechBubble(scene: Phaser.Scene, x: number, y: number, w: number, h: number, depth = 18) {
  const g = scene.add.graphics().setDepth(depth);
  const left = x - w / 2;
  const top = y - h / 2;
  drawPanel(g, left, top, w, h, 0.96);
  const b = top + h;
  g.fillStyle(C_GOLD, 0.96).fillTriangle(x - 13, b - 4, x + 13, b - 4, x, b + 15);
  g.fillStyle(C_NAVY, 0.96).fillTriangle(x - 9, b - 6, x + 9, b - 6, x, b + 9);
  return g;
}

function sizeRevealPanel(panel: Phaser.GameObjects.Graphics, text: Phaser.GameObjects.Text) {
  const w = Math.min(338, Math.max(258, text.width + 32));
  const h = Math.max(66, text.height + 18);
  panel.clear();
  drawPanel(panel, GAME_WIDTH / 2 - w / 2, text.y - h / 2, w, h, 0.96);
}

function pixelButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  tone: 'primary' | 'secondary',
  onClick: () => void,
  fontSize = 20,
) {
  const g = scene.add.graphics();
  const left = -w / 2;
  const top = -h / 2;
  const c = Math.min(11, Math.floor(Math.min(w, h) / 4));
  const fill = tone === 'primary' ? C_PINK : C_NAVY;
  const border = tone === 'primary' ? C_PINK_DK : C_GOLD;
  const hi = tone === 'primary' ? C_PINK_HI : 0x2c3e63;
  const txtCol = tone === 'primary' ? '#fff4ec' : T_CREAM;
  fillNotch(g, left, top, w, h, c, C_NAVY_DARK, 1);
  fillNotch(g, left + 3, top + 3, w - 6, h - 6, c - 1, border, 1);
  fillNotch(g, left + 6, top + 6, w - 12, h - 12, c - 2, fill, 1);
  g.fillStyle(hi, 1).fillRect(left + 10, top + 8, w - 20, 4);
  const t = scene.add
    .text(0, 1, label.toUpperCase(), { fontFamily: FONT_BODY, fontSize: `${fontSize}px`, color: txtCol, fontStyle: 'bold' })
    .setOrigin(0.5);
  const cont = scene.add.container(x, y, [g, t]).setSize(w, h).setDepth(31);
  // setSize() centres the container's display origin, so input hit-testing reports
  // local coords relative to the top-left (0..w, 0..h) — the hit area must match that,
  // not the centre-relative rect used for drawing, or only part of the button is live.
  cont.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
  cont.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, e?: Phaser.Types.Input.EventData) => {
    e?.stopPropagation?.();
    scene.tweens.add({ targets: cont, scaleX: 0.97, scaleY: 0.92, duration: 70, yoyo: true });
    onClick();
  });
  return cont;
}
