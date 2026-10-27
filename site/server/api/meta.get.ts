import { buildMeta } from "../utils/queries.ts";
import { loadDataset } from "../utils/results.ts";
import { resultsDir } from "../utils/paths.ts";
import { separateParam } from "../utils/query.ts";
import { respond } from "../utils/respond.ts";

export default defineEventHandler((event) => {
  const ds = loadDataset(resultsDir());
  const separate = separateParam(getQuery(event));
  return respond(event, ds, `meta|${separate}`, () => buildMeta(ds, separate));
});
