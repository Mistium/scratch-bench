import { startBenchRun } from "../../utils/bench-run.ts";

export default defineTask({
  meta: {
    name: "bench:nightly",
    description: "Run the benchmark suites and record the results",
  },
  run() {
    return { result: startBenchRun("schedule") };
  },
});
