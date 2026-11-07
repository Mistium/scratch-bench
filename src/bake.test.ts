import { expect, test } from "bun:test";
import { bake, POINTER, type Recording } from "./bake.ts";

const block = (opcode: string, rest: Record<string, unknown> = {}) => ({
  opcode,
  next: null,
  parent: null,
  inputs: {},
  fields: {},
  shadow: false,
  topLevel: false,
  ...rest,
});

const project = () => ({
  targets: [
    {
      isStage: true,
      name: "Stage",
      variables: { gv: ["speed", 1] },
      lists: { out: ["output", ["theirs"]] },
      broadcasts: {},
      blocks: {},
      comments: {},
      costumes: [],
      sounds: [],
    },
    {
      isStage: false,
      name: "Cat",
      layerOrder: 1,
      variables: {},
      lists: {},
      broadcasts: {},
      comments: {},
      costumes: [],
      sounds: [],
      blocks: {
        // when space key pressed: wait 1 (a script that waits)
        hat: block("event_whenkeypressed", { topLevel: true, next: "w", fields: { KEY_OPTION: ["space", null] } }),
        w: block("control_wait", { parent: "hat", inputs: { DURATION: [1, [4, "1"]] } }),
        // when this sprite clicked: say (mouse x); stop all
        click: block("event_whenthisspriteclicked", { topLevel: true, next: "say" }),
        say: block("looks_say", { parent: "click", next: "stop", inputs: { MESSAGE: [3, "mx", [10, ""]] } }),
        mx: block("sensing_mousex", { parent: "say" }),
        stop: block("control_stop", {
          parent: "say",
          fields: { STOP_OPTION: ["all", null] },
          mutation: { tagName: "mutation", children: [], hasnext: "false" },
        }),
        // if key (w) pressed? then ask "name?" and wait
        if: block("control_if", { topLevel: true, inputs: { CONDITION: [2, "kp"], SUBSTACK: [2, "ask"] } }),
        kp: block("sensing_keypressed", { parent: "if", inputs: { KEY_OPTION: [1, "km"] } }),
        km: block("sensing_keyoptions", { parent: "kp", shadow: true, fields: { KEY_OPTION: ["w", null] } }),
        ask: block("sensing_askandwait", { parent: "if", inputs: { QUESTION: [1, [10, "name?"]] } }),
        // go to mouse-pointer
        go: block("motion_goto", { topLevel: true, inputs: { TO: [1, "gm"] } }),
        gm: block("motion_goto_menu", { parent: "go", shadow: true, fields: { TO: ["_mouse_", null] } }),
      },
    },
  ],
  monitors: [],
  extensions: [],
});

const recording: Recording = {
  framerate: 30,
  frames: 6,
  passes: [1, 2, 1, 1, 1, 1],
  inputs: [
    { frame: 0, type: "greenFlag" },
    { frame: 1, type: "mouse", x: 10.4, y: -300, down: true },
    { frame: 2, type: "key", key: " ", down: true },
    { frame: 3, type: "key", key: " ", down: true },
    { frame: 3, type: "key", key: "Alt", down: true },
    { frame: 4, type: "key", key: " ", down: false },
    { frame: 4, type: "answer", text: "Ada" },
    { frame: 5, type: "variable", target: null, id: "gv", value: 4 },
  ],
};

const listNamed = (target: any, name: string) =>
  Object.values(target.lists as Record<string, [string, unknown[]]>).find((l) => l[0] === name)?.[1];
const ops = (target: any) => Object.values(target.blocks as Record<string, any>).map((b) => b.opcode);

test("bake places the recorded events by tick and rewires the project's inputs to the pointer", () => {
  const { project: p, ticks, recordedMs } = bake(project(), recording, { id: "1", budgetMs: 1000 });
  const [stage, cat, pointer] = p.targets;
  expect(ticks).toBe(7);
  expect(recordedMs).toBe(200);
  expect(pointer.name).toBe(POINTER);
  expect(pointer.layerOrder).toBe(2);

  // Frame 1 starts at tick 1, frame 2 at tick 3 (frame 1 ran 2 ticks), and so on. The pointer is
  // kept on the stage and rounded; the press is off the stage, so it isn't a click. Alt is ignored.
  expect(listNamed(pointer, "event tick")).toEqual([1, 1, 3, 4, 5, 5, 6]);
  expect(listNamed(pointer, "event kind")).toEqual(["move", "down", "key", "key", "release", "answer", "set"]);
  expect(listNamed(pointer, "event a")).toEqual([10, 1, "space", "space", "space", "Ada", 1]);
  expect(listNamed(pointer, "event b")).toEqual([-180, "", 1, 0, "", "", 4]);

  // The project's own output list is renamed so the harness reads the replay's.
  expect(listNamed(stage, "output (project)")).toEqual(["theirs"]);
  expect(listNamed(stage, "output")).toEqual([]);

  const catOps = ops(cat);
  for (const gone of ["event_whenkeypressed", "event_whenthisspriteclicked", "sensing_mousex", "sensing_keypressed", "sensing_askandwait"]) {
    expect(catOps).not.toContain(gone);
  }
  const blocks = cat.blocks;
  // A key script that waits only starts on a fresh press.
  expect(blocks.hat.fields.BROADCAST_OPTION[0]).toBe("replay key once space");
  // A click only runs on the clone under the pointer.
  expect(blocks.click.fields.BROADCAST_OPTION[0]).toBe("replay click Cat");
  expect(blocks[blocks.click.next].opcode).toBe("control_if");
  expect(blocks.say.inputs.MESSAGE[1]).toEqual([12, "replay mouse x", expect.any(String)]);
  // stop all broadcasts instead, then waits for the stop-all scripts to stop it.
  expect(blocks[blocks.say.next].opcode).toBe("event_broadcast");
  expect(blocks[blocks[blocks.say.next].next].opcode).toBe("control_wait_until");
  expect(blocks[blocks.if.inputs.CONDITION[1]].opcode).toBe("data_listcontainsitem");
  expect(blocks[blocks.if.inputs.SUBSTACK[1]].opcode).toBe("control_wait_until");
  expect(blocks.gm.fields.TO[0]).toBe(POINTER);
  // Every target stops its other scripts on the replay's stop all, and the slider's owner sets it.
  expect(ops(stage)).toContain("control_stop");
  expect(ops(stage)).toContain("data_setvariableto");
});


test("bake parks stop all inside a custom block, since stop this script would return to the caller", () => {
  const p = project();
  Object.assign(p.targets[1].blocks, {
    def: block("procedures_definition", { topLevel: true, next: "end", inputs: { custom_block: [1, "proto"] } }),
    proto: block("procedures_prototype", {
      parent: "def",
      shadow: true,
      mutation: { tagName: "mutation", children: [], proccode: "end", argumentids: "[]", warp: "false" },
    }),
    end: block("control_stop", {
      parent: "def",
      fields: { STOP_OPTION: ["all", null] },
      mutation: { tagName: "mutation", children: [], hasnext: "false" },
    }),
  });
  const blocks = bake(p, recording, { id: "1", budgetMs: 1000 }).project.targets[1].blocks;
  const sent = blocks[blocks.def.next];
  expect(sent.opcode).toBe("event_broadcast");
  expect(blocks[sent.next].opcode).toBe("control_wait_until");
});
