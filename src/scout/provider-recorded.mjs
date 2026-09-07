// The recorded provider: replays a committed fixture store, keylessly and
// deterministically. This is the half of the strategy-benchmark pattern that
// makes CI and a stranger's first run reproduce a real run exactly, with no
// Anthropic key, no network, and no chance of a different answer on Tuesday.
//
// It replays the transcript UNJUDGED. The fixtures deliberately carry claims
// that must not survive — a fabricated funding number, a citation to a page
// that was never fetched, a confident uncited assertion — and the provider
// hands all of them through untouched. If the provider filtered them, the gate
// could rot without a single test going red.
//
// Fixture store format (see WIRING.md for the recorder contract):
//
//   fixtures/<slug>/account.json     { accountName, domain?, questions? }
//   fixtures/<slug>/pages.json       [ { url, title, fetchedAt, content } ]
//   fixtures/<slug>/transcript.json  { searches: [{query, results:[{url,title}]}],
//                                      candidates: [{text, kind, citations:[{url,quote}]}] }

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { makeHop } from "../types.mjs";
import { ScoutRefusal } from "./errors.mjs";

function readJson(dir, name) {
  const path = join(dir, name);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ScoutRefusal(
      `recorded mode cannot read the fixture store at ${path} — refusing rather than researching nothing. ` +
        `Record it with the Lane E recorder, or point --fixtures at a directory holding ` +
        `account.json, pages.json and transcript.json.`,
      { cause: err },
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ScoutRefusal(`fixture ${path} is not valid JSON: ${err.message}`, { cause: err });
  }
}

/**
 * @param {string} fixtureDir Directory holding the three store files.
 * @returns {object} A Provider (interface documented in src/scout/WIRING.md).
 */
export function recordedProvider(fixtureDir) {
  const account = readJson(fixtureDir, "account.json");
  const pages = readJson(fixtureDir, "pages.json");
  const transcript = readJson(fixtureDir, "transcript.json");

  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const byQuery = new Map((transcript.searches ?? []).map((s) => [s.query, s.results ?? []]));

  return Object.freeze({
    mode: "recorded",
    // Nothing produced a recorded report, so it names no model. The contract
    // only requires meta.model in live mode, which is exactly this distinction.
    model: undefined,

    account: Object.freeze({
      accountName: account.accountName,
      domain: account.domain,
      questions: Object.freeze([...(account.questions ?? [])]),
    }),

    /** An unrecorded query returns nothing. A miss is recorded honestly as a
     *  miss; the runner's early stop reads it the same way a live empty page
     *  of results would read. */
    async search(query) {
      return (byQuery.get(query) ?? []).map((r) => Object.freeze({ url: r.url, title: r.title }));
    },

    async fetchPage(url) {
      const page = byUrl.get(url);
      if (!page)
        throw new ScoutRefusal(
          `recorded mode has no page for ${url} in ${fixtureDir}. A hop with no content would let a ` +
            `citation bind against emptiness, so this refuses instead. Re-record the fixture if the ` +
            `page belongs in the run.`,
        );
      return makeHop({
        url: page.url,
        title: page.title,
        fetchedAt: page.fetchedAt,
        content: page.content,
      });
    },

    /** Replayed exactly as recorded, including the candidates that must not
     *  survive. Judging is the gate's job, and only the gate's. */
    async proposeClaims() {
      return (transcript.candidates ?? []).map((c) =>
        Object.freeze({
          text: c.text,
          kind: c.kind,
          citations: Object.freeze((c.citations ?? []).map((cit) => Object.freeze({ ...cit }))),
        }),
      );
    },
  });
}
