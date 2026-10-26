import { startBenchRun } from "../utils/bench-run.ts";

export default defineEventHandler((event) => {
  const token = process.env.BENCH_TOKEN;
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: "BENCH_TOKEN is not configured on the server",
    });
  }
  if (getHeader(event, "authorization") !== `Bearer ${token}`) {
    throw createError({ statusCode: 401, statusMessage: "invalid token" });
  }
  const result = startBenchRun("manual");
  if (!result.started) setResponseStatus(event, 409);
  return result;
});
