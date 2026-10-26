import { buildLatest } from "../utils/queries.ts";
import { loadDataset } from "../utils/results.ts";
import { resultsDir } from "../utils/paths.ts";
import { hostParam } from "../utils/query.ts";
import { respond } from "../utils/respond.ts";

export default defineEventHandler((event) => {
  const ds = loadDataset(resultsDir());
  const host = hostParam(getQuery(event));
  return respond(event, ds, `latest|${host}`, () => buildLatest(ds, host));
});
