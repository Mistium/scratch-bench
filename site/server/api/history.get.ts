import { buildHistory } from "../utils/queries.ts";
import { loadDataset } from "../utils/results.ts";
import { resultsDir } from "../utils/paths.ts";
import { benchParam, dateParam, hostParam } from "../utils/query.ts";
import { respond } from "../utils/respond.ts";

export default defineEventHandler((event) => {
  const ds = loadDataset(resultsDir());
  const q = getQuery(event);
  const args = {
    host: hostParam(q),
    from: dateParam(q, "from"),
    to: dateParam(q, "to", true),
    bench: benchParam(q),
    rsd: q.rsd === "1",
  };
  return respond(
    event,
    ds,
    `history|${JSON.stringify(args)}`,
    () => buildHistory(ds, args),
  );
});
