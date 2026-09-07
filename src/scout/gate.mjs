// THE DETERMINISTIC CITATION GATE.
//
// The rule this repo is built around: a deterministic check only blocks on
// violations it can DECIDE. Three things are decidable from the shapes alone,
// and each one refuses:
//
//   1. a candidate with zero citations
//   2. a citation whose quote does not appear in the fetched content
//   3. a citation whose URL was never fetched this run
//
// Everything else — is this source credible, does this evidence really support
// this claim — is judgment, and judgment belongs to the gtm-agent-evals rubric,
// not to a regex wearing a robe.
//
// Two design decisions worth stating, because both are the strict reading:
//
// * ONE BAD CITATION REFUSES THE WHOLE CLAIM. A candidate carrying a citation
//   that does not check out is a candidate whose evidence was hallucinated or
//   tampered with. Keeping it alive on its surviving citation would launder the
//   bad half behind the good one.
// * NOTHING IS EVER DROPPED. Every candidate leaves this function as exactly one
//   of a Claim or a Refusal. A refusal is output, not an error path, so
//   claims.length + refusals.length === candidates.length always holds.

import { makeCitation, makeClaim, makeRefusal, validateCitationAgainstHops, CLAIM_KINDS } from "../types.mjs";

/** Hostname, lowercased, with a leading www. removed. Null when unparseable. */
function hostOf(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let host;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  // A bare "not a url" parses as a hostname-less or dotless host; a real
  // property always has a dot, so treat the dotless case as unparseable.
  if (!host.includes(".")) return null;
  return host.replace(/^www\./, "");
}

/**
 * primary = the account's own domain or a subdomain of it. secondary = anything
 * else, including every case we cannot decide (no domain known, unparseable
 * URL). Unknown never flatters the source.
 *
 * @param {string} url
 * @param {string|undefined} domain
 * @returns {"primary"|"secondary"}
 */
export function citationTier(url, domain) {
  const account = hostOf(domain);
  const cited = hostOf(url);
  if (!account || !cited) return "secondary";
  return cited === account || cited.endsWith(`.${account}`) ? "primary" : "secondary";
}

/**
 * Fill a raw citation out to the contract's shape, taking title and fetchedAt
 * from the hop it names when that hop exists. A citation naming a URL that was
 * never fetched still has to be CONSTRUCTIBLE — the gate refuses it, not the
 * constructor, so the refusal names the real reason instead of a type error.
 */
function normalizeCitation(raw, hops, runAt) {
  const hop = hops.find((h) => h.url === raw?.url);
  return makeCitation({
    url: raw?.url,
    title: raw?.title ?? hop?.title ?? "(untitled)",
    fetchedAt: raw?.fetchedAt ?? hop?.fetchedAt ?? runAt,
    quote: raw?.quote,
  });
}

/**
 * Run every candidate through the gate.
 *
 * @param {object} args
 * @param {Array<{id?: string, text: string, kind: string, citations?: Array<object>}>} args.candidates
 * @param {Array<object>} args.hops The fetched-URL trail citations bind against.
 * @param {string|undefined} args.domain The account's own domain, for tiering.
 * @param {string} args.runAt ISO timestamp, the fallback fetchedAt.
 * @returns {{claims: Array<object>, refusals: Array<object>}}
 */
export function gateCandidates({ candidates, hops, domain, runAt }) {
  const claims = [];
  const refusals = [];

  candidates.forEach((candidate, index) => {
    const text = typeof candidate?.text === "string" ? candidate.text : "";
    const refuse = (reason) => refusals.push(makeRefusal({ text: text || "(candidate carried no text)", reason }));

    if (!text) {
      refuse("candidate carried no text — a claim with nothing to check cannot be checked");
      return;
    }

    if (!CLAIM_KINDS.includes(candidate.kind)) {
      refuse(
        `claim kind ${JSON.stringify(candidate.kind)} is not one of ${CLAIM_KINDS.join("/")} — ` +
          `an unrecognized kind is refused rather than coerced into a valid one`,
      );
      return;
    }

    const rawCitations = Array.isArray(candidate.citations) ? candidate.citations : [];
    if (rawCitations.length === 0) {
      refuse("claim carries no citation — an uncited claim is a refusal, not a claim");
      return;
    }

    let citations;
    try {
      citations = rawCitations.map((raw) => normalizeCitation(raw, hops, runAt));
    } catch (err) {
      refuse(`citation is malformed and cannot be checked: ${err.message}`);
      return;
    }

    // Fail closed: the FIRST citation that does not check out refuses the whole
    // claim. A surviving citation never launders a failing one.
    let failure = null;
    for (const citation of citations) {
      const verdict = validateCitationAgainstHops(citation, hops);
      if (!verdict.ok) {
        failure = `${verdict.reason} — quote was: ${JSON.stringify(citation.quote)}`;
        break;
      }
    }
    if (failure) {
      refuse(failure);
      return;
    }

    // A claim resting on any first-party evidence is primary; its strongest
    // source is what it is tiered by.
    const tier = citations.some((c) => citationTier(c.url, domain) === "primary") ? "primary" : "secondary";

    try {
      claims.push(
        makeClaim({
          id: candidate.id ?? `c${index + 1}`,
          text,
          kind: candidate.kind,
          citations,
          tier,
        }),
      );
    } catch (err) {
      refuse(`claim failed the contract after passing the citation check: ${err.message}`);
    }
  });

  return { claims, refusals };
}
