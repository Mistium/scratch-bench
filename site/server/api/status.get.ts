import { benchStatus } from "../utils/bench-run.ts";

export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  return benchStatus(useRuntimeConfig(event).benchSchedule || null);
});
