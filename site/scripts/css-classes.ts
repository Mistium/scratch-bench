import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../app");
const cssFile = path.join(root, "assets/css/main.css");

const files: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".vue")) files.push(p);
  }
};
walk(root);

interface Usage {
  classes: Set<string>;
  attrs: Map<string, Set<string>>;
}
const usage = new Map<string, Usage>();

for (const file of files.sort()) {
  const text = fs.readFileSync(file, "utf8");
  const template = text.slice(text.indexOf("<template>"));
  const u: Usage = { classes: new Set(), attrs: new Map() };

  for (const m of template.matchAll(/\sclass="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c && !c.includes("{{")) u.classes.add(c);
    }
  }
  for (const m of template.matchAll(/:class="([^"]+)"/g)) {
    for (const lit of m[1].matchAll(/'([a-z][a-z0-9_-]*)'/g)) {
      u.classes.add(lit[1]);
    }
  }
  for (const m of template.matchAll(/\s:?(data-[a-z-]+)="([^"]*)"/g)) {
    const set = u.attrs.get(m[1]) ?? new Set();
    set.add(
      /^[a-z0-9_ -]+$/i.test(m[2]) && !m[0].trim().startsWith(":")
        ? m[2]
        : "<dynamic>",
    );
    u.attrs.set(m[1], set);
  }
  usage.set(path.relative(root, file), u);
}

const css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, "utf8") : "";
const styled = (c: string) =>
  new RegExp(`\\.${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css);
const onlyMissing = process.argv.includes("--missing");

const all = new Set<string>();
for (const [file, u] of usage) {
  const classes = [...u.classes].sort().filter((c) =>
    !onlyMissing || !styled(c)
  );
  classes.forEach((c) => all.add(c));
  if (!classes.length && !(!onlyMissing && u.attrs.size)) continue;
  console.log(`\n${file}`);
  for (const c of classes) {
    console.log(`  .${c}${styled(c) ? "  (styled)" : ""}`);
  }
  if (!onlyMissing) {
    for (const [a, v] of [...u.attrs].sort()) {
      console.log(`  [${a}] ${[...v].sort().join(" | ")}`);
    }
  }
}
console.log(`\n${all.size} classes${onlyMissing ? " without a rule yet" : ""}`);
