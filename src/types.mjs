// The shared contract. FROZEN for the lanes: every lane codes to these shapes,
// and a change here is a cross-lane event that goes through the orchestrator,
// never one lane's discretion. Plain-object factories + validators, house style.
//
// The load-bearing idea: a Citation is CHECKABLE. Its quote must appear verbatim
// in content fetched during the same run, so "cited" is a property the code can
// decide, not a formatting convention. Everything the deterministic gate refuses
// is decidable from these shapes alone; judgment belongs to the evals rubric.

export const CLAIM_KINDS = Object.freeze(["numeric", "causal", "factual"]);
export const SOURCE_TIERS = Object.freeze(["primary", "secondary"]);
export const MODES = Object.freeze(["live", "recorded"]);

/** A validated research request. Throws naming the missing field, never a
 *  silent default — an unverified request must not become a job. */
export function makeResearchRequest({ accountName, domain, questions, requestId }) {
  if (typeof accountName !== "string" || accountName.trim() === "")
    throw new Error("ResearchRequest needs a non-empty accountName");
  if (typeof requestId !== "string" || requestId.trim() === "")
    throw new Error("ResearchRequest needs a requestId (the idempotency key rides on it)");
  if (domain !== undefined && typeof domain !== "string")
    throw new Error("ResearchRequest domain, when given, is a string");
  if (questions !== undefined && !Array.isArray(questions))
    throw new Error("ResearchRequest questions, when given, is an array of strings");
  return Object.freeze({
    accountName: accountName.trim(),
    domain: domain?.trim(),
    questions: questions ? Object.freeze([...questions]) : undefined,
    requestId,
  });
}

/** One fetched page in a run. The hops[] trail is what citations bind against. */
export function makeHop({ url, title, fetchedAt, content }) {
  for (const [k, v] of Object.entries({ url, title, fetchedAt, content }))
    if (typeof v !== "string") throw new Error(`Hop ${k} must be a string`);
  return Object.freeze({ url, title, fetchedAt, content });
}

/** A citation. `quote` must appear verbatim in the content of a hop with the
 *  same url, fetched in this run — validateCitationAgainstHops decides that. */
export function makeCitation({ url, title, fetchedAt, quote }) {
  for (const [k, v] of Object.entries({ url, title, fetchedAt, quote }))
    if (typeof v !== "string" || v === "")
      throw new Error(`Citation ${k} must be a non-empty string`);
  return Object.freeze({ url, title, fetchedAt, quote });
}

/** The decidable half of "is this cited": the URL was fetched this run and the
 *  quote appears verbatim in what was fetched. Returns { ok, reason }. */
export function validateCitationAgainstHops(citation, hops) {
  const hop = hops.find((h) => h.url === citation.url);
  if (!hop) return { ok: false, reason: `citation url was never fetched this run: ${citation.url}` };
  if (!hop.content.includes(citation.quote))
    return { ok: false, reason: `quote does not appear in the fetched content of ${citation.url}` };
  return { ok: true };
}

export function makeClaim({ id, text, kind, citations, tier }) {
  if (typeof id !== "string" || id === "") throw new Error("Claim needs an id");
  if (typeof text !== "string" || text === "") throw new Error("Claim needs text");
  if (!CLAIM_KINDS.includes(kind))
    throw new Error(`Claim kind must be one of ${CLAIM_KINDS.join("/")}, got ${JSON.stringify(kind)}`);
  if (!Array.isArray(citations) || citations.length === 0)
    throw new Error("Claim needs at least one citation — an uncited claim is a Refusal, not a Claim");
  if (!SOURCE_TIERS.includes(tier))
    throw new Error(`Claim tier must be one of ${SOURCE_TIERS.join("/")}, got ${JSON.stringify(tier)}`);
  return Object.freeze({ id, text, kind, citations: Object.freeze([...citations]), tier });
}

/** A would-be claim the gate refused. First-class output, never dropped. */
export function makeRefusal({ text, reason }) {
  if (typeof text !== "string" || text === "") throw new Error("Refusal needs the refused text");
  if (typeof reason !== "string" || reason === "") throw new Error("Refusal needs its reason");
  return Object.freeze({ text, reason });
}

export function makeResearchReport({ account, generatedAt, claims, refusals, hops, meta }) {
  if (typeof account !== "string" || account === "") throw new Error("Report needs the account name");
  if (typeof generatedAt !== "string") throw new Error("Report needs generatedAt (ISO, with timezone)");
  for (const [k, v] of Object.entries({ claims, refusals, hops }))
    if (!Array.isArray(v)) throw new Error(`Report ${k} must be an array`);
  if (!meta || !MODES.includes(meta.mode))
    throw new Error(`Report meta.mode must be one of ${MODES.join("/")}`);
  if (meta.mode === "live" && (typeof meta.model !== "string" || meta.model === ""))
    throw new Error("A live report must name the model that produced it (unattributed verdicts cannot be challenged)");
  return Object.freeze({
    account, generatedAt,
    claims: Object.freeze([...claims]),
    refusals: Object.freeze([...refusals]),
    hops: Object.freeze([...hops]),
    meta: Object.freeze({ ...meta }),
  });
}
