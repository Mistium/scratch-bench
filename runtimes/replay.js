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
    /**
     * The frames at which the script time so far is reported, so a runtime that didn't get through
     * the whole recording can be compared with another on exactly the frames it did.
     */
    CHECKPOINTS: [1, 2, 3, 5, 8, 13, 20, 30, 50, 80, 120, 200, 300, 500, 800],
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
    /**
     * A list's values for the state hash. A long list (an emulator's memory, say) is its length and
     * 1000 items spread across it: enough to show a runtime computing something else, without
     * copying millions of items every 30 frames.
     */
    listValues(list) {
      if (list.length <= 10_000) return list.map(this.round);
      const step = list.length / 1000;
      return [list.length, ...Array.from({ length: 1000 }, (_, i) => this.round(list[Math.floor(i * step)]))];
    },
    yieldToEventLoop: () => new Promise((resolve) => {
      queue.push(resolve);
      channel.port2.postMessage(null);
    }),
    /**
     * Tells the runner how far the replay has got, at each checkpoint, so that if a frame never ends
     * it can still report the frames before it.
     */
    report: (r) =>
      console.log(`[REPLAY] checkpoint ${r.frame} ${r.frameMs} ${r.scriptMs} ${r.drawMs} ${r.drifted}`),
    /** Tells the runner a frame is starting, with the script time and drift before it. */
    started: (r) => console.log(`[REPLAY] frame ${r.frame} ${r.scriptMs} ${r.drawMs} ${r.drifted}`),
    /** The result line (projects/REPLAY.md). */
    line: (id, r) => {
      const ms = (x) => Math.round(x * 10) / 10;
      const marks = Object.entries(r.checkpoints).map(([f, t]) => `${f}:${ms(t)}`).join(",");
      return `${id} | ${ms(r.scriptMs)} | ${ms(r.drawMs)} | ${ms(r.frameMs)} | ${r.frames}/${r.recorded} | ${r.drifted} | ${fnv1a(r.hashes.join(""))} | ${marks}`;
    },
  };
})();
