const tasks = new Set<() => void>();

export const onCleanup = (task: () => void): () => void => {
  tasks.add(task);
  return () => tasks.delete(task);
};

const runAll = () => {
  for (const t of tasks) {
    try {
      t();
    } catch {}
  }
  tasks.clear();
};

for (
  const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], [
    "SIGHUP",
    129,
  ]] as const
) {
  process.on(sig, () => {
    runAll();
    process.exit(code);
  });
}
process.on("exit", runAll);
