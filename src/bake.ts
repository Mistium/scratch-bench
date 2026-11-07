/**
 * Bakes a recording of someone using a project into the project itself, so any Scratch runtime can
 * replay it with nothing but the green flag: no browser, no input injection.
 *
 * A sprite named "replay pointer" is added on top. Its green-flag script steps through the
 * recorded events one scheduler tick at a time (its thread is the first in the tick, so each
 * tick's events land before the project's scripts run) and stands in for the mouse itself, a
 * transparent 2px sprite at the recorded pointer position. The project's input blocks are
 * rewired to it:
 *
 * - `mouse x`, `mouse y`, `mouse down?`, `key _ pressed?` and `answer` read variables and lists
 *   the pointer keeps;
 * - "mouse-pointer" in touching, distance, go to, glide and point towards menus is the pointer;
 * - `when _ key pressed`, `when this sprite clicked` and `when stage clicked` become broadcasts
 *   the pointer sends (a click goes to the sprites under the pointer);
 * - `ask and wait` waits for the recorded answer;
 * - `stop all` stops every other script and deletes clones without stopping the replay;
 * - slider changes the recording made are broadcast to scripts that set the variable.
 *
 * The pointer times every tick with `days since 2000` and, when the recording ends (or the time
 * budget runs out), adds a result line and DONE to the stage's `output` list:
 *
 *     <id> | <ms> | <ticks run>/<ticks recorded> | <worst gap ms> | <long frames> | <recorded ms>
 *
 * Events are placed by tick rather than by frame, so they reach the project at the same point in
 * its run however many ticks a runtime fits into a frame. It plays in real time, as a person
 * would see it, so the time is the recorded time plus whatever the runtime couldn't keep up with.
 */

export type Input =
  | { frame: number; type: "greenFlag" }
  | { frame: number; type: "mouse"; x: number; y: number; button?: number; down?: boolean }
  | { frame: number; type: "key"; key: string; keyCode?: number; down: boolean }
  | { frame: number; type: "wheel"; dx: number; dy: number }
  | { frame: number; type: "variable"; target: string | null; id: string; value: unknown }
  | { frame: number; type: "answer"; text: string }
  | { frame: number; type: "turbo"; on: boolean };

export interface Recording {
  framerate: number;
  frames: number;
  /** Scheduler ticks that ran in each frame of the recording. */
  passes: number[];
  inputs: Input[];
}

export interface BakeOptions {
  id: string;
  /** Replay at most this many recorded frames. */
  maxFrames?: number;
  /** Real time the replay may take before it stops and reports how far it got. */
  budgetMs: number;
}

export interface Baked {
  project: Project;
  /** Asset files to add to the sb3. */
  assets: [string, Uint8Array][];
  ticks: number;
  recordedMs: number;
}

// deno-lint-ignore no-explicit-any
type Project = any;
// deno-lint-ignore no-explicit-any
type Block = any;
type Blocks = Record<string, Block>;

export const POINTER = "replay pointer";
const POINTER_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" viewBox="0 0 2 2"><rect width="2" height="2" fill="#000"/></svg>',
);
/** A gap between ticks longer than this is a frame the runtime couldn't keep up with. */
const LONG_FRAME_MS = 50;

/** Scratch's names for the keys it knows by more than one character (TurboWarp's set). */
const SPECIAL_KEYS: Record<string, string> = {
  " ": "space",
  ArrowLeft: "left arrow",
  Left: "left arrow",
  ArrowUp: "up arrow",
  Up: "up arrow",
  ArrowRight: "right arrow",
  Right: "right arrow",
  ArrowDown: "down arrow",
  Down: "down arrow",
  Enter: "enter",
  Backspace: "backspace",
  Delete: "delete",
  Shift: "shift",
  CapsLock: "caps lock",
  ScrollLock: "scroll lock",
  Control: "control",
  Escape: "escape",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "page up",
  PageDown: "page down",
};
const KEY_NAMES = [...new Set(Object.values(SPECIAL_KEYS))];
const MAKEY_KEYS: Record<string, string> = {
  SPACE: "space",
  LEFT: "left arrow",
  UP: "up arrow",
  RIGHT: "right arrow",
  DOWN: "down arrow",
};

/** Blocks that can make a script wait a tick or more. */
const YIELDS = new Set([
  "control_wait",
  "control_repeat",
  "control_forever",
  "control_repeat_until",
  "control_while",
  "control_for_each",
  "control_wait_until",
  "motion_glidesecstoxy",
  "motion_glideto",
  "looks_sayforsecs",
  "looks_thinkforsecs",
  "looks_switchbackdroptoandwait",
  "event_broadcastandwait",
  "sound_playuntildone",
  "sensing_askandwait",
  "text2speech_speakAndWait",
]);

// ---- a small builder for Scratch blocks ----

interface Ref {
  ref: "var" | "list";
  name: string;
  id: string;
}
interface Blk {
  op: string;
  in?: Record<string, In>;
  f?: Record<string, [string, string | null]>;
  mut?: Record<string, unknown>;
}
/** A block already in the project, moved into a new spot. */
interface Existing {
  existing: string;
}
/** A variable or list reporter in the compact form an sb3 stores in inputs. */
interface Primitive {
  primitive: unknown[];
}
type In = string | number | Ref | Blk | Existing | Primitive | Blk[];

const BOOL_SLOTS: Record<string, string[]> = {
  control_if: ["CONDITION"],
  control_if_else: ["CONDITION"],
  control_repeat_until: ["CONDITION"],
  control_wait_until: ["CONDITION"],
  operator_and: ["OPERAND1", "OPERAND2"],
  operator_or: ["OPERAND1", "OPERAND2"],
  operator_not: ["OPERAND"],
};
const MENUS: Record<string, Record<string, string>> = {
  sensing_touchingobject: { TOUCHINGOBJECTMENU: "sensing_touchingobjectmenu" },
};

const b = (op: string, inputs: Record<string, In> = {}, fields = {}, mut?: Record<string, unknown>): Blk => ({
  op,
  in: inputs,
  f: fields,
  mut,
});
const field = (r: Ref): [string, string] => [r.name, r.id];
const set = (v: Ref, value: In) => b("data_setvariableto", { VALUE: value }, { VARIABLE: field(v) });
const change = (v: Ref, by: In) => b("data_changevariableby", { VALUE: by }, { VARIABLE: field(v) });
const ifThen = (cond: Blk, then: Blk[]) => b("control_if", { CONDITION: cond, SUBSTACK: then });
const until = (cond: Blk, body: Blk[]) => b("control_repeat_until", { CONDITION: cond, SUBSTACK: body });
const repeat = (times: In, body: Blk[]) => b("control_repeat", { TIMES: times, SUBSTACK: body });
const eq = (x: In, y: In) => b("operator_equals", { OPERAND1: x, OPERAND2: y });
const gt = (x: In, y: In) => b("operator_gt", { OPERAND1: x, OPERAND2: y });
const or = (x: Blk, y: Blk) => b("operator_or", { OPERAND1: x, OPERAND2: y });
const and = (x: Blk, y: Blk) => b("operator_and", { OPERAND1: x, OPERAND2: y });
const not = (x: Blk) => b("operator_not", { OPERAND: x });
const sub = (x: In, y: In) => b("operator_subtract", { NUM1: x, NUM2: y });
const add = (x: In, y: In) => b("operator_add", { NUM1: x, NUM2: y });
const mul = (x: In, y: In) => b("operator_multiply", { NUM1: x, NUM2: y });
const div = (x: In, y: In) => b("operator_divide", { NUM1: x, NUM2: y });
const round = (x: In) => b("operator_round", { NUM: x });
const join = (...parts: In[]): In =>
  parts.reduceRight((rest, part) => b("operator_join", { STRING1: part, STRING2: rest }));
const letter = (i: In, s: In) => b("operator_letter_of", { LETTER: i, STRING: s });
const days = () => b("sensing_dayssince2000");
const item = (i: In, l: Ref) => b("data_itemoflist", { INDEX: i }, { LIST: field(l) });
const itemNum = (x: In, l: Ref) => b("data_itemnumoflist", { ITEM: x }, { LIST: field(l) });
const length = (l: Ref) => b("data_lengthoflist", {}, { LIST: field(l) });
const contains = (l: Ref, x: In) => b("data_listcontainsitem", { ITEM: x }, { LIST: field(l) });
const push = (l: Ref, x: In) => b("data_addtolist", { ITEM: x }, { LIST: field(l) });
const remove = (l: Ref, i: In) => b("data_deleteoflist", { INDEX: i }, { LIST: field(l) });
const clear = (l: Ref) => b("data_deletealloflist", {}, { LIST: field(l) });
const touching = (what: In) => b("sensing_touchingobject", { TOUCHINGOBJECTMENU: what });
const stop = (option: string) =>
  b("control_stop", {}, { STOP_OPTION: [option, null] }, {
    tagName: "mutation",
    children: [],
    hasnext: String(option.startsWith("other")),
  });

class Builder {
  private n = 0;
  constructor(
    private blocks: Blocks,
    private broadcast: (name: string) => [string, string],
  ) {}

  id(): string {
    let id: string;
    do id = `replay-${this.n++}`; while (id in this.blocks);
    return id;
  }

  /** Adds a command stack under `parent`; returns the id of its first block. */
  stack(cmds: Blk[], parent: string | null): string | null {
    let first: string | null = null;
    let prev: string | null = null;
    for (const cmd of cmds) {
      const id = this.block(cmd, prev ?? parent);
      if (prev) this.blocks[prev].next = id;
      else first = id;
      prev = id;
    }
    return first;
  }

  script(hat: Blk, body: Blk[], x = 0, y = 0): string {
    const id = this.block(hat, null);
    Object.assign(this.blocks[id], { topLevel: true, x, y, next: this.stack(body, id) });
    return id;
  }

  /** A custom block run without screen refresh, and a call to it. */
  procedure(proccode: string, body: Blk[]): Blk {
    const def = this.id();
    const proto = this.id();
    const mutation = { tagName: "mutation", children: [], proccode, argumentids: "[]", warp: "true" };
    this.blocks[proto] = {
      opcode: "procedures_prototype",
      next: null,
      parent: def,
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: { ...mutation, argumentnames: "[]", argumentdefaults: "[]" },
    };
    this.blocks[def] = {
      opcode: "procedures_definition",
      next: null,
      parent: null,
      inputs: { custom_block: [1, proto] },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 600,
    };
    this.blocks[def].next = this.stack(body, def);
    return b("procedures_call", {}, {}, mutation);
  }

  block(blk: Blk, parent: string | null): string {
    const id = this.id();
    const block: Block = {
      opcode: blk.op,
      next: null,
      parent,
      inputs: {},
      fields: blk.f ?? {},
      shadow: false,
      topLevel: false,
    };
    if (blk.mut) block.mutation = blk.mut;
    this.blocks[id] = block;
    for (const [name, value] of Object.entries(blk.in ?? {})) {
      block.inputs[name] = this.input(blk.op, name, value, id);
    }
    return id;
  }

  input(op: string, name: string, value: In, parent: string): unknown[] {
    if (Array.isArray(value)) return [2, this.stack(value, parent)];
    if (op === "event_broadcast" && name === "BROADCAST_INPUT") {
      if (typeof value === "string" || typeof value === "number") {
        return [1, [11, ...this.broadcast(String(value))]];
      }
      return [3, this.reporter(value, parent), [11, ...this.broadcast("replay")]];
    }
    const menu = MENUS[op]?.[name];
    if (menu) {
      const shadow = this.id();
      this.blocks[shadow] = {
        opcode: menu,
        next: null,
        parent,
        inputs: {},
        fields: { [name]: [typeof value === "object" ? POINTER : String(value), null] },
        shadow: true,
        topLevel: false,
      };
      return typeof value === "string" || typeof value === "number"
        ? [1, shadow]
        : [3, this.reporter(value, parent), shadow];
    }
    if (typeof value === "number") return [1, [4, String(value)]];
    if (typeof value === "string") return [1, [10, value]];
    if ("ref" in value) return [3, [value.ref === "var" ? 12 : 13, value.name, value.id], [10, ""]];
    if ("primitive" in value) return [3, structuredClone(value.primitive), [10, ""]];
    const id = this.reporter(value, parent);
    return BOOL_SLOTS[op]?.includes(name) ? [2, id] : [3, id, [10, ""]];
  }

  reporter(value: Blk | Existing | Ref | Primitive, parent: string): string {
    if ("ref" in value || "primitive" in value) throw new Error("a variable can't go in a menu");
    if ("existing" in value) {
      this.blocks[value.existing].parent = parent;
      return value.existing;
    }
    return this.block(value, parent);
  }

  /** A copy of an existing reporter and everything in it. */
  copy(id: string): Existing {
    const copyOf = (from: string, parent: string | null): string => {
      const to = this.id();
      const block = structuredClone(this.blocks[from]);
      block.parent = parent;
      for (const input of Object.values(block.inputs) as unknown[][]) {
        for (let k = 1; k < input.length; k++) {
          if (typeof input[k] === "string" && input[k] as string in this.blocks) {
            input[k] = copyOf(input[k] as string, to);
          }
        }
      }
      this.blocks[to] = block;
      return to;
    };
    return { existing: copyOf(id, null) };
  }
}

// ---- reading and rewriting project blocks ----

const isBlock = (x: unknown): x is Block => !!x && typeof x === "object" && !Array.isArray(x);

/** Deletes a block and everything plugged into it (not the blocks after it). */
const deleteTree = (blocks: Blocks, id: string) => {
  const block = blocks[id];
  if (!isBlock(block)) return;
  delete blocks[id];
  for (const input of Object.values(block.inputs ?? {}) as unknown[][]) {
    for (const x of input.slice(1)) if (typeof x === "string") deleteTree(blocks, x);
  }
};

/** Points whatever holds `id` (its parent's input or `next`) at `to` instead. */
const relink = (blocks: Blocks, id: string, to: string | null) => {
  const parent = blocks[blocks[id].parent];
  if (!parent) return;
  if (parent.next === id) {
    parent.next = to;
    return;
  }
  for (const input of Object.values(parent.inputs) as unknown[][]) {
    if (input[1] === id) input[1] = to;
  }
};

const holds = (block: Block, id: string) =>
  isBlock(block) && Object.values(block.inputs ?? {}).some((input) => (input as unknown[])[1] === id);

/** Swaps a reporter in the input holding it for `with_(holderId)`, then deletes it. */
const replaceReporter = (
  blocks: Blocks,
  id: string,
  with_: (parent: string) => { var: Ref } | { block: string },
) => {
  // Some saved projects have parent links that are out of date, so look for the real holder.
  const parentId = holds(blocks[blocks[id].parent], id)
    ? blocks[id].parent
    : Object.keys(blocks).find((k) => holds(blocks[k], id));
  const parent = parentId && blocks[parentId];
  if (parent) {
    const made = with_(parentId);
    for (const input of Object.values(parent.inputs) as unknown[][]) {
      if (input[1] !== id) continue;
      if ("var" in made) {
        input.splice(0, input.length, 3, [12, made.var.name, made.var.id], input[2] ?? [10, ""]);
      } else input[1] = made.block;
    }
  }
  deleteTree(blocks, id);
};

/** Swaps a command for a stack of new ones in the same place. */
const replaceCommand = (blocks: Blocks, build: Builder, id: string, cmds: Blk[]) => {
  const old = blocks[id];
  const first = build.stack(cmds, old.parent)!;
  let last = first;
  while (blocks[last].next) last = blocks[last].next;
  blocks[last].next = old.next;
  if (old.next) blocks[old.next].parent = last;
  if (old.topLevel) Object.assign(blocks[first], { topLevel: true, x: old.x ?? 0, y: old.y ?? 0 });
  relink(blocks, id, first);
  old.next = null;
  deleteTree(blocks, id);
};

/** Whether running a script from `start` can wait a tick (custom blocks run with screen refresh too). */
const scriptYields = (blocks: Blocks, start: string | null, seen = new Set<string>()): boolean => {
  for (let id = start; id && isBlock(blocks[id]); id = blocks[id].next) {
    const block = blocks[id];
    if (YIELDS.has(block.opcode)) return true;
    if (block.opcode === "procedures_call" && block.mutation?.warp !== "true") {
      const code = block.mutation?.proccode;
      if (!seen.has(code)) {
        seen.add(code);
        const def = Object.values(blocks).find((d) =>
          isBlock(d) && d.opcode === "procedures_definition" &&
          blocks[d.inputs?.custom_block?.[1]]?.mutation?.proccode === code
        );
        if (def && scriptYields(blocks, def.next, seen)) return true;
      }
    }
    for (const [name, input] of Object.entries(block.inputs ?? {}) as [string, unknown[]][]) {
      if (name.startsWith("SUBSTACK") && typeof input[1] === "string") {
        if (scriptYields(blocks, input[1], seen)) return true;
      }
    }
  }
  return false;
};

/** The stage size the TurboWarp settings comment asks for, and the comment with its frame rate removed. */
const turbowarpConfig = (stage: Block): { width: number; height: number } => {
  for (const comment of Object.values(stage.comments ?? {}) as Block[]) {
    if (typeof comment.text !== "string" || !comment.text.includes("// _twconfig_")) continue;
    // Every runtime plays at 30 fps, so the replay takes the same real time on all of them.
    comment.text = comment.text.replace(/"framerate":\d+,?/, "").replace(/,(\s*})/, "$1");
    const size = (key: string) => Number(new RegExp(`"${key}":(\\d+)`).exec(comment.text)?.[1]);
    return { width: size("width") || 480, height: size("height") || 360 };
  }
  return { width: 480, height: 360 };
};

const md5 = (data: Uint8Array) => new Bun.CryptoHasher("md5").update(data).digest("hex");

export const bake = (source: Project, recording: Recording, o: BakeOptions): Baked => {
  const project: Project = structuredClone(source);
  const stage = project.targets.find((t: Block) => t.isStage);
  const sprites = project.targets.filter((t: Block) => !t.isStage);
  if (sprites.some((t: Block) => t.name === POINTER)) throw new Error(`a sprite is already named ${POINTER}`);
  const { width, height } = turbowarpConfig(stage);

  // ---- the stage's variables, lists and broadcasts the replay adds ----
  let made = 0;
  const newId = (kind: string) => `replay-${kind}-${made++}`;
  const broadcasts = new Map<string, [string, string]>();
  const broadcast = (name: string): [string, string] => {
    const key = name.toLowerCase();
    if (!broadcasts.has(key)) {
      const id = newId("message");
      stage.broadcasts[id] = name;
      broadcasts.set(key, [name, id]);
    }
    return broadcasts.get(key)!;
  };
  const variable = (target: Block, name: string, value: unknown = 0): Ref => {
    const id = newId("var");
    target.variables[id] = [name, value];
    return { ref: "var", name, id };
  };
  const list = (target: Block, name: string, value: unknown[] = []): Ref => {
    const id = newId("list");
    target.lists[id] = [name, value];
    return { ref: "list", name, id };
  };

  // The harness reads the stage's `output` list; a project's own is renamed out of the way.
  for (const [id, entry] of Object.entries(stage.lists) as [string, [string, unknown[]]][]) {
    if (entry[0] !== "output") continue;
    entry[0] = "output (project)";
    for (const target of project.targets) {
      for (const block of Object.values(target.blocks) as Block[]) {
        if (Array.isArray(block) && block[0] === 13 && block[2] === id) block[1] = entry[0];
        if (!isBlock(block)) continue;
        if (block.fields?.LIST?.[1] === id) block.fields.LIST[0] = entry[0];
        for (const input of Object.values(block.inputs ?? {}) as unknown[][]) {
          for (const x of input) if (Array.isArray(x) && x[0] === 13 && x[2] === id) x[1] = entry[0];
        }
      }
    }
    for (const monitor of project.monitors ?? []) {
      if (monitor.id === id) monitor.params.LIST = entry[0];
    }
  }

  const mouseX = variable(stage, "replay mouse x");
  const mouseY = variable(stage, "replay mouse y");
  const mouseDown = variable(stage, "replay mouse down");
  const answer = variable(stage, "replay answer", "");
  const value = variable(stage, "replay value", "");
  const keys = list(stage, "replay keys");
  const answers = list(stage, "replay answers");
  const keyNames = list(stage, "replay key names", KEY_NAMES);
  const output = list(stage, "output");

  // ---- the recorded events, by tick ----
  const flags = recording.inputs.filter((i) => i.type === "greenFlag").map((i) => i.frame);
  const firstFrame = flags[0] ?? 0;
  // A second green flag restarts everything, which a replay can't; it stops there.
  const endFrame = Math.min(
    recording.frames,
    flags[1] ?? Infinity,
    firstFrame + (o.maxFrames ?? Infinity),
  );
  const tickOf: number[] = [];
  for (let f = firstFrame, t = 0; f <= endFrame; t += recording.passes[f++] ?? 0) tickOf[f] = t;
  const ticks = tickOf[endFrame];

  const inputs = [...recording.inputs].sort((x, y) => x.frame - y.frame);
  const events: [number, string, unknown, unknown][] = [];
  const setters = new Map<string, { target: Block; id: string; n: number }>();
  const held = new Set<string>();
  let mouse = { x: 0, y: 0, down: false };
  for (const input of inputs) {
    if (input.frame < firstFrame || input.frame >= endFrame) continue;
    const t = tickOf[input.frame];
    if (t >= ticks) continue;
    if (input.type === "mouse") {
      // Scratch reports the pointer rounded and kept on the stage.
      const x = Math.round(Math.max(-width / 2, Math.min(width / 2, input.x)));
      const y = Math.round(Math.max(-height / 2, Math.min(height / 2, input.y)));
      if (x !== mouse.x || y !== mouse.y) events.push([t, "move", x, y]);
      mouse = { ...mouse, x, y };
      if (input.down !== undefined && input.down !== mouse.down) {
        mouse.down = input.down;
        events.push([t, "down", input.down ? 1 : 0, ""]);
        // A press starts click scripts, unless it's off the stage.
        if (input.down && Math.abs(input.x) < width / 2 && Math.abs(input.y) < height / 2) {
          events.push([t, "click", "", ""]);
        }
      }
    } else if (input.type === "key") {
      const key = SPECIAL_KEYS[input.key] ?? (input.key.length === 1 ? input.key.toLowerCase() : "");
      if (!key) continue; // modifiers and other keys Scratch ignores
      if (input.down) {
        events.push([t, "key", key, held.has(key) ? 0 : 1]);
        held.add(key);
      } else if (held.delete(key)) events.push([t, "release", key, ""]);
    } else if (input.type === "wheel") {
      // Scratch turns the wheel into presses of the up and down arrow keys, for hats only.
      if (input.dy) events.push([t, "wheel", input.dy < 0 ? "up arrow" : "down arrow", ""]);
    } else if (input.type === "answer") {
      events.push([t, "answer", input.text, ""]);
    } else if (input.type === "variable") {
      const target = input.target === null
        ? stage
        : sprites.find((s: Block) => s.name === input.target);
      if (!target?.variables[input.id]) continue;
      const key = `${target.name}\0${input.id}`;
      if (!setters.has(key)) setters.set(key, { target, id: input.id, n: setters.size + 1 });
      events.push([t, "set", setters.get(key)!.n, input.value]);
    }
  }

  // ---- rewiring the project's input blocks ----
  const clickable: string[] = [];
  let stageClicks = false;
  let stopsAll = false;
  for (const target of project.targets) {
    const blocks: Blocks = target.blocks;
    const build = new Builder(blocks, broadcast);
    for (const id of Object.keys(blocks)) {
      const block = blocks[id];
      if (!isBlock(block)) continue;
      switch (block.opcode) {
        case "sensing_mousex":
          replaceReporter(blocks, id, () => ({ var: mouseX }));
          break;
        case "sensing_mousey":
          replaceReporter(blocks, id, () => ({ var: mouseY }));
          break;
        case "sensing_answer":
          replaceReporter(blocks, id, () => ({ var: answer }));
          break;
        case "sensing_mousedown":
          replaceReporter(blocks, id, (p) => ({ block: build.block(eq(mouseDown, 1), p) }));
          break;
        case "sensing_keypressed": {
          const input = block.inputs.KEY_OPTION;
          const menu = blocks[input[input[0] === 1 ? 1 : 2]];
          const reporter = input[0] === 1 ? null : input[1];
          let expr: Blk;
          if (!reporter) {
            const key = String(menu?.fields?.KEY_OPTION?.[0] ?? "").toLowerCase();
            expr = key === "any" ? gt(length(keys), 0) : contains(keys, key);
          } else {
            // Scratch takes a key name, or else the first letter of whatever is in the slot.
            const slot = (): In =>
              Array.isArray(reporter) ? { primitive: reporter } : build.copy(reporter);
            expr = or(
              or(
                contains(keys, slot()),
                and(not(contains(keyNames, slot())), contains(keys, letter(1, slot()))),
              ),
              and(eq(slot(), "any"), gt(length(keys), 0)),
            );
          }
          replaceReporter(blocks, id, (p) => ({ block: build.block(expr, p) }));
          break;
        }
        case "sensing_askandwait":
          replaceCommand(blocks, build, id, [
            b("control_wait_until", { CONDITION: gt(length(answers), 0) }),
            set(answer, item(1, answers)),
            remove(answers, 1),
          ]);
          break;
        case "control_stop":
          if (block.fields.STOP_OPTION[0] === "all") {
            stopsAll = true;
            replaceCommand(blocks, build, id, [
              b("event_broadcast", { BROADCAST_INPUT: "replay stop all" }),
              stop("this script"),
            ]);
          }
          break;
        case "event_whenkeypressed": {
          // Real key hats don't restart a script that's still running, and broadcasts do, so a
          // held key only restarts scripts that finish at once.
          const key = String(block.fields.KEY_OPTION[0]).toLowerCase();
          const once = scriptYields(blocks, block.next) ? "once " : "";
          block.opcode = "event_whenbroadcastreceived";
          block.fields = { BROADCAST_OPTION: broadcast(`replay key ${once}${key}`) };
          break;
        }
        case "makeymakey_whenMakeyKeyPressed": {
          const menu = blocks[block.inputs.KEY?.[1]];
          const raw = String(menu?.fields?.KEY?.[0] ?? "");
          deleteTree(blocks, block.inputs.KEY?.[1]);
          block.opcode = "event_whenbroadcastreceived";
          block.inputs = {};
          block.fields = { BROADCAST_OPTION: broadcast(`replay key once ${MAKEY_KEYS[raw] ?? raw.toLowerCase()}`) };
          break;
        }
        case "event_whenthisspriteclicked":
        case "event_whenstageclicked": {
          block.opcode = "event_whenbroadcastreceived";
          if (target.isStage) {
            stageClicks = true;
            block.fields = { BROADCAST_OPTION: broadcast("replay click stage") };
            break;
          }
          if (!clickable.includes(target.name)) clickable.push(target.name);
          block.fields = { BROADCAST_OPTION: broadcast(`replay click ${target.name}`) };
          // The click goes to every clone of the sprite, so each checks it's the one under the pointer.
          if (block.next) {
            const body = block.next;
            const guard = build.block(ifThen(touching(POINTER), []), id);
            blocks[guard].inputs.SUBSTACK = [2, body];
            blocks[body].parent = guard;
            block.next = guard;
          }
          break;
        }
      }
      // "mouse-pointer" in a menu is the pointer sprite.
      if (block.shadow) {
        for (const f of Object.values(block.fields ?? {}) as unknown[][]) {
          if (f[0] === "_mouse_") f[0] = POINTER;
        }
      }
    }
  }

  // ---- scripts the replay needs in the project's targets ----
  for (const target of project.targets) {
    const build = new Builder(target.blocks, broadcast);
    if (stopsAll) {
      build.script(
        b("event_whenbroadcastreceived", {}, { BROADCAST_OPTION: broadcast("replay stop all") }),
        target.isStage
          ? [stop("other scripts in stage"), b("looks_cleargraphiceffects"), b("sound_stopallsounds")]
          : [
            stop("other scripts in sprite"),
            b("looks_cleargraphiceffects"),
            b("looks_say", { MESSAGE: "" }),
            b("control_delete_this_clone"),
          ],
        0,
        -400,
      );
    }
    for (const s of setters.values()) {
      if (s.target !== target) continue;
      const [name] = target.variables[s.id];
      build.script(
        b("event_whenbroadcastreceived", {}, { BROADCAST_OPTION: broadcast(`replay set ${s.n}`) }),
        [set({ ref: "var", name, id: s.id }, value)],
        0,
        -300 - 100 * s.n,
      );
    }
  }

  // ---- the pointer sprite that plays the recording ----
  const pointer: Block = {
    isStage: false,
    name: POINTER,
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [{
      name: "pointer",
      bitmapResolution: 1,
      dataFormat: "svg",
      assetId: md5(POINTER_SVG),
      md5ext: `${md5(POINTER_SVG)}.svg`,
      rotationCenterX: 1,
      rotationCenterY: 1,
    }],
    sounds: [],
    volume: 100,
    layerOrder: Math.max(0, ...sprites.map((s: Block) => s.layerOrder ?? 0)) + 1,
    visible: true,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: "all around",
  };
  project.targets.push(pointer);
  const local = (name: string, v: unknown = 0) => variable(pointer, name, v);
  const tick = local("tick");
  const i = local("i");
  const next = local("next");
  const now = local("now");
  const last = local("last");
  const start = local("start");
  const deadline = local("deadline");
  const worst = local("worst");
  const long = local("long frames");
  const j = local("j");
  const hit = local("hit");
  const kind = local("kind", "");
  const a = local("a", "");
  const bArg = local("b", "");
  const evTick = list(pointer, "event tick", events.map((e) => e[0]));
  const evKind = list(pointer, "event kind", events.map((e) => e[1]));
  const evA = list(pointer, "event a", events.map((e) => e[2]));
  const evB = list(pointer, "event b", events.map((e) => e[3]));
  const clickables = list(pointer, "clickable sprites", clickable);
  const allSprites = list(pointer, "sprites", sprites.map((s: Block) => s.name));

  const dayMs = 86_400_000;
  // Every runtime plays at 30 fps, so this is how long a runtime that keeps up takes.
  const recordedMs = Math.round(((endFrame - firstFrame) / 30) * 1000);
  const build = new Builder(pointer.blocks, broadcast);
  const on = (k: string, body: Blk[]) => ifThen(eq(kind, k), body);
  const send = (...name: In[]) => b("event_broadcast", { BROADCAST_INPUT: name.length > 1 ? join(...name) : name[0] });
  const click: Blk[] = [
    set(hit, 0),
    set(j, 1),
    repeat(length(clickables), [
      ifThen(touching(item(j, clickables)), [send("replay click ", item(j, clickables)), set(hit, 1)]),
      change(j, 1),
    ]),
  ];
  if (stageClicks) {
    click.push(
      set(j, 1),
      repeat(length(allSprites), [ifThen(touching(item(j, allSprites)), [set(hit, 1)]), change(j, 1)]),
      ifThen(eq(hit, 0), [send("replay click stage")]),
    );
  }
  const dispatch = build.procedure("replay events", [
    until(or(gt(i, length(evTick)), gt(item(i, evTick), tick)), [
      set(kind, item(i, evKind)),
      set(a, item(i, evA)),
      set(bArg, item(i, evB)),
      on("move", [set(mouseX, a), set(mouseY, bArg), b("motion_gotoxy", { X: a, Y: bArg })]),
      on("down", [set(mouseDown, a)]),
      on("click", click),
      on("key", [
        ifThen(not(contains(keys, a)), [push(keys, a)]),
        send("replay key ", a),
        send("replay key any"),
        ifThen(eq(bArg, 1), [send("replay key once ", a), send("replay key once any")]),
      ]),
      on("release", [remove(keys, itemNum(a, keys))]),
      on("wheel", [send("replay key ", a), send("replay key once ", a)]),
      on("answer", [push(answers, a)]),
      on("set", [set(value, bArg), send("replay set ", a)]),
      change(i, 1),
    ]),
    set(next, item(i, evTick)),
  ]);
  const measure = [
    set(now, days()),
    ifThen(gt(sub(now, last), worst), [set(worst, sub(now, last))]),
    ifThen(gt(sub(now, last), LONG_FRAME_MS / dayMs), [change(long, 1)]),
    set(last, now),
  ];
  const ms = (x: In) => div(round(mul(x, dayMs * 10)), 10);
  // A line for the harness: the TurboWarp debugger's log block, which native runtimes print, and
  // the stage's output list, which the browser runners read.
  const print = (line: In): Blk[] => [
    b("procedures_call", { arg0: line }, {}, {
      tagName: "mutation",
      children: [],
      proccode: "\u200b\u200blog\u200b\u200b %s",
      argumentids: '["arg0"]',
      warp: "false",
    }),
    push(output, line),
  ];
  build.script(b("event_whenflagclicked"), [
    b("looks_seteffectto", { VALUE: 100 }, { EFFECT: ["GHOST", null] }),
    b("looks_show"),
    b("motion_gotoxy", { X: 0, Y: 0 }),
    set(mouseX, 0),
    set(mouseY, 0),
    set(mouseDown, 0),
    set(answer, ""),
    clear(keys),
    clear(answers),
    set(i, 1),
    set(tick, 0),
    set(worst, 0),
    set(long, 0),
    set(next, item(1, evTick)),
    set(start, days()),
    set(last, start),
    set(now, start),
    set(deadline, add(start, o.budgetMs / dayMs)),
    ...print(join(o.id, " | started")),
    until(or(eq(tick, ticks), gt(now, deadline)), [
      ...measure,
      ifThen(eq(tick, next), [dispatch]),
      change(tick, 1),
    ]),
    ...measure,
    ...print(
      join(
        o.id,
        " | ",
        ms(sub(now, start)),
        " | ",
        tick,
        "/",
        ticks,
        " | ",
        ms(worst),
        " | ",
        long,
        " | ",
        recordedMs,
      ),
    ),
    ...print("DONE"),
  ]);

  return { project, assets: [[`${md5(POINTER_SVG)}.svg`, POINTER_SVG]], ticks, recordedMs };
};
