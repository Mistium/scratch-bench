import { buildMeta } from "../utils/queries.ts";
import { loadDataset } from "../utils/results.ts";
import { resultsDir } from "../utils/paths.ts";
import { respond } from "../utils/respond.ts";

export default defineEventHandler((event) => {
  const ds = loadDataset(resultsDir());
  return respond(event, ds, "meta", () => buildMeta(ds));
});
