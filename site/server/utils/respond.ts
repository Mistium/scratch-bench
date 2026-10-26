import crypto from "node:crypto";
import type { H3Event } from "h3";
import type { Dataset } from "./results.ts";

const memo = new Map<string, unknown>();

export const respond = <T>(
  event: H3Event,
  ds: Dataset,
  key: string,
  build: () => T,
): T | null => {
  const full = `${ds.signature}::${key}`;
  const etag = `"${
    crypto.createHash("sha1").update(full).digest("hex").slice(0, 16)
  }"`;
  setHeader(event, "ETag", etag);
  setHeader(event, "Cache-Control", "no-cache");
  if (getHeader(event, "if-none-match") === etag) {
    setResponseStatus(event, 304);
    return null;
  }
  if (!memo.has(full)) {
    if (memo.size > 200) memo.clear();
    memo.set(full, build());
  }
  return memo.get(full) as T;
};
