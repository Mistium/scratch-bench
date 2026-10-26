import fs from "node:fs";

const out = process.argv[process.argv.indexOf("--out") + 1];
const ms = Number(process.env.FAKE_MS ?? 0);
setTimeout(() => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(`${out}/meta.json`, "{}");
  process.exit(Number(process.env.FAKE_EXIT ?? 0));
}, ms);
