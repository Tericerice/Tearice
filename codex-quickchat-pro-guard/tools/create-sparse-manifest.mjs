#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [sourcePath, patchedPath] = process.argv.slice(2);
if (!sourcePath || !patchedPath) {
  console.error("Usage: node tools/create-sparse-manifest.mjs <source> <patched>");
  process.exit(2);
}

const source = readFileSync(sourcePath);
const patched = readFileSync(patchedPath);
const anchorLength = 64;
const maxLookahead = 64 * 1024;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function findSync(sourceOffset, patchedOffset) {
  const sourceEnd = Math.min(source.length - anchorLength, sourceOffset + maxLookahead);
  const patchedEnd = Math.min(patched.length - anchorLength, patchedOffset + maxLookahead);
  const sourceAnchors = new Map();

  for (let offset = sourceOffset; offset <= sourceEnd; offset += 1) {
    const key = source.subarray(offset, offset + anchorLength).toString("base64");
    if (!sourceAnchors.has(key)) sourceAnchors.set(key, offset);
  }

  let best = null;
  for (let offset = patchedOffset; offset <= patchedEnd; offset += 1) {
    const key = patched.subarray(offset, offset + anchorLength).toString("base64");
    const sourceMatch = sourceAnchors.get(key);
    if (sourceMatch === undefined) continue;

    const deleteLength = sourceMatch - sourceOffset;
    const insertLength = offset - patchedOffset;
    const score = [Math.max(deleteLength, insertLength), deleteLength + insertLength];
    if (
      best === null ||
      score[0] < best.score[0] ||
      (score[0] === best.score[0] && score[1] < best.score[1])
    ) {
      best = { sourceMatch, patchedMatch: offset, score };
    }
  }

  return best;
}

const operations = [];
let sourceOffset = 0;
let patchedOffset = 0;

while (sourceOffset < source.length && patchedOffset < patched.length) {
  while (
    sourceOffset < source.length &&
    patchedOffset < patched.length &&
    source[sourceOffset] === patched[patchedOffset]
  ) {
    sourceOffset += 1;
    patchedOffset += 1;
  }

  if (sourceOffset === source.length || patchedOffset === patched.length) break;
  const sync = findSync(sourceOffset, patchedOffset);
  if (!sync) {
    throw new Error(`Unable to synchronize sparse diff at source=${sourceOffset}, patched=${patchedOffset}`);
  }

  const deleted = source.subarray(sourceOffset, sync.sourceMatch);
  const inserted = patched.subarray(patchedOffset, sync.patchedMatch);
  operations.push({
    offset: sourceOffset,
    delete_length: deleted.length,
    delete_sha256: sha256(deleted),
    insert_utf8_base64: inserted.toString("base64"),
  });
  sourceOffset = sync.sourceMatch;
  patchedOffset = sync.patchedMatch;
}

if (sourceOffset !== source.length || patchedOffset !== patched.length) {
  const deleted = source.subarray(sourceOffset);
  const inserted = patched.subarray(patchedOffset);
  operations.push({
    offset: sourceOffset,
    delete_length: deleted.length,
    delete_sha256: sha256(deleted),
    insert_utf8_base64: inserted.toString("base64"),
  });
}

const replay = Buffer.from(source);
let rebuilt = replay;
for (const operation of [...operations].reverse()) {
  const inserted = Buffer.from(operation.insert_utf8_base64, "base64");
  rebuilt = Buffer.concat([
    rebuilt.subarray(0, operation.offset),
    inserted,
    rebuilt.subarray(operation.offset + operation.delete_length),
  ]);
}

if (!rebuilt.equals(patched)) throw new Error("Sparse operations did not reproduce patched input");

process.stdout.write(`${JSON.stringify({
  source_sha256: sha256(source),
  patched_sha256: sha256(patched),
  operations,
}, null, 2)}\n`);
