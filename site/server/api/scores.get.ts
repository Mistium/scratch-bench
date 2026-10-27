import { buildScores } from "../utils/queries.ts";
import { loadDataset } from "../utils/results.ts";
import { resultsDir } from "../utils/paths.ts";
import {
  dateParam,
  hostParam,
  separateParam,
  weightsParam,
} from "../utils/query.ts";
import { respond } from "../utils/respond.ts";

export default defineEventHandler((event) => {
  const ds = loadDataset(resultsDir());
  const q = getQuery(event);
  const args = {
    host: hostParam(q),
    weights: weightsParam(q),
    separate: separateParam(q),
    from: dateParam(q, "from"),
    to: dateParam(q, "to", true),
  };
  return respond(
    event,
    ds,
    `scores|${JSON.stringify(args)}`,
    () => buildScores(ds, args),
  );
});
