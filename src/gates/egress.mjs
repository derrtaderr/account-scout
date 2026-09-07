// Lane D — egress. Nothing leaves this process unguarded.
//
// redaction-gate's guard() sits in front of every writer that carries text out:
// the report file, the stdout summary line, and the webhook reply. The library
// does the work — precise redaction first (a rostered name becomes its typed
// placeholder and the write proceeds as a working document), then the paranoid
// scan over the redacted text, and a survivor REFUSES the write before the
// writer ever runs. Nothing lands, and the refusal names classes and positions,
// never values, which is redaction-gate's own guarantee (RedactionRefusal
// strips terms unless revealTerms is set — this lane never sets it).
//
// The roster is the operator's sensitive vocabulary — client names, people —
// supplied by config. It is NOT the research subject: the account under
// research is meant to appear in its own report; the operator's other clients
// are not. Built-in detectors (secret/email/domain/phone/ipv4/residue/
// honorific) stay on: this module never passes a `patterns` block, so nothing
// is switched off.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createGate, redact } from "redaction-gate";

/**
 * The redaction config for the scout. Roster and allowDomains pass straight
 * through to redaction-gate; nothing disables a built-in detector.
 *
 * @param {object} [opts]
 * @param {Array<{class: string, match: string[], as?: string}>} [opts.roster]
 * @param {string[]} [opts.allowDomains] hosts that are ours and fine to keep
 *   (the account's own domain, typically — a report about northwind.example
 *   must be allowed to cite northwind.example).
 * @param {string[]} [opts.allow] literal strings that never become a finding.
 */
export function scoutRedactionConfig({ roster = [], allowDomains = [], allow = [] } = {}) {
  const config = { roster };
  if (allowDomains.length > 0) config.allowDomains = allowDomains;
  if (allow.length > 0) config.allow = allow;
  return config;
}

/**
 * Serialize a ResearchReport to one markdown document carrying a fenced JSON
 * block of the full report. One file, one string, one guarded write — the
 * whole report (claims, refusals, hop content, meta) is in the scanned text,
 * so there is no second surface a leak could ride out on.
 *
 * @param {object} report a frozen ResearchReport from src/types.mjs
 * @returns {string}
 */
export function serializeReport(report) {
  const lines = [];
  lines.push(`# Account research: ${report.account}`);
  lines.push("");
  const model = report.meta.model ? `, model: ${report.meta.model}` : "";
  lines.push(`Generated ${report.generatedAt} (mode: ${report.meta.mode}${model})`);
  lines.push("");
  lines.push(`## Claims (${report.claims.length})`);
  lines.push("");
  for (const claim of report.claims) {
    lines.push(`- [${claim.kind}/${claim.tier}] ${claim.text}`);
    for (const c of claim.citations) lines.push(`  - ${c.url} — "${c.quote}"`);
  }
  lines.push("");
  lines.push(`## Refusals (${report.refusals.length})`);
  lines.push("");
  for (const r of report.refusals) lines.push(`- ${r.text} — ${r.reason}`);
  lines.push("");
  lines.push(`## Hops (${report.hops.length})`);
  lines.push("");
  for (const h of report.hops) lines.push(`- ${h.url} — ${h.title} (${h.fetchedAt})`);
  lines.push("");
  lines.push("## Machine-readable");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report, null, 2));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

/**
 * The egress boundary, bound to one resolved redaction config.
 *
 * @param {object} [opts] passes to scoutRedactionConfig; plus:
 * @param {{write: (s: string) => void}} [opts.out] the summary stream
 *   (default process.stdout), injectable so tests never print.
 * @returns {{
 *   gate: object,
 *   writeReport: (report: object, path: string) => Promise<{path: string}>,
 *   emitSummary: (report: object) => Promise<string>,
 *   makeReplyWriter: (send: Function) => Function,
 * }}
 */
export function createEgress({ out = process.stdout, ...configOpts } = {}) {
  const config = scoutRedactionConfig(configOpts);
  const gate = createGate(config);

  /** Redact a single string with THIS egress's config. Fail closed: anything
   *  redact refuses (a non-string included) comes back as a marker, never the
   *  raw text — telemetry uses this so events.jsonl is post-redaction. */
  const redactText = (text) => {
    try {
      return redact(String(text), config);
    } catch (err) {
      return `[unredactable: ${err?.name ?? "error"}]`;
    }
  };

  // The actual writers, each wrapped ONCE. guard() redacts, scans the redacted
  // text, and throws RedactionRefusal before the inner function runs when
  // anything survives — so a refused report/summary/reply lands nowhere.

  const writeFileGuarded = gate.guard(
    ({ path, text }) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
      return { path };
    },
    {
      label: "report-file",
      get: (p) => p.text,
      set: (p, text) => ({ ...p, text }),
    },
  );

  const emitGuarded = gate.guard(
    (line) => {
      out.write(line + "\n");
      return line;
    },
    { label: "stdout-summary" },
  );

  return {
    gate,
    redactText,

    /** Serialize and write the report to `path`. Refuses (throws
     *  RedactionRefusal) with nothing on disk when the gate trips. */
    writeReport(report, path) {
      return writeFileGuarded({ path, text: serializeReport(report) });
    },

    /** One guarded line on stdout. Returns the line as written (redacted). */
    emitSummary(report) {
      const line =
        `account-scout: ${report.account} — ${report.claims.length} claim(s), ` +
        `${report.refusals.length} refusal(s), ${report.hops.length} hop(s) [${report.meta.mode}]`;
      return emitGuarded(line);
    },

    /** Wrap the server's reply sender. `send` receives the payload with its
     *  `body` redacted; a survivor refuses before `send` is ever called. */
    makeReplyWriter(send) {
      return gate.guard(send, {
        label: "webhook-reply",
        get: (p) => p.body,
        set: (p, text) => ({ ...p, body: text }),
      });
    },
  };
}
