import { buildLatest } from "../utils/queries.ts";
import { loadDataset } from "../utils/results.ts";
import { resultsDir } from "../utils/paths.ts";
import { hostParam, separateParam } from "../utils/query.ts";
import { respond } from "../utils/respond.ts";

export default defineEventHandler((event) => {
  const ds = loadDataset(resultsDir());
  const q = getQuery(event);
  const host = hostParam(q);
  const separate = separateParam(q);
  return respond(
    event,
    ds,
    `latest|${host}|${separate}`,
    () => buildLatest(ds, host, separate),
  );
});
