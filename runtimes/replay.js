// What every browser runner's replay shares (projects/REPLAY.md). Loaded as a classic script, before
// the runtime's own scripts, so they only ever see the patched Date and Math.random.
window.BenchReplay = (() => {
  // Date is a virtual clock the replay moves one frame interval per frame; within a frame it stands
  // still. performance.now() is left alone for the measurements.
  const RealDate = Date;
  let virtualNow = 0;
  class VirtualDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(virtualNow);
      else super(...args);
    }
    static now() {
      return virtualNow;
    }
  }
  // Math.random is sfc32, seeded.
  let a, b, c, d;
  const random = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  const seed = (s) => {
    a = 0x9e3779b9; b = 0x243f6a88; c = 0xb7e15162; d = s >>> 0;
    for (let i = 0; i < 16; i++) random();
  };

  const fnv1a = (str) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };

  // MessageChannel instead of setTimeout(0), which gets clamped to 4 ms after a few nested calls.
  const channel = new MessageChannel();
  const queue = [];
  channel.port1.onmessage = () => queue.shift()();

  return {
    EPOCH: RealDate.UTC(2025, 0, 1, 12, 0, 0),
    /** State is hashed this often, and at the end. */
    CHECK_INTERVAL: 30,
    /** Scaffolding (TurboWarp's player) starts dragging a sprite held this long without moving. */
    DRAG_HOLD_MS: 400,
    DRAG_DISTANCE: 3,
    install() {
      window.Date = VirtualDate;
      Math.random = random;
      seed(1);
      virtualNow = this.EPOCH;
    },
    setTime: (ms) => (virtualNow = ms),
    seed,
    fnv1a,
    round: (n) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n),
    yieldToEventLoop: () => new Promise((resolve) => {
      queue.push(resolve);
      channel.port2.postMessage(null);
    }),
    /** The result line (projects/REPLAY.md). */
    line: (id, r) => {
      const ms = (x) => Math.round(x * 10) / 10;
      return `${id} | ${ms(r.scriptMs)} | ${ms(r.drawMs)} | ${ms(r.wallMs)} | ${r.frames}/${r.recorded} | ${r.drifted} | ${fnv1a(r.hashes.join(""))}`;
    },
  };
})();
