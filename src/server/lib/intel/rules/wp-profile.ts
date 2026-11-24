// EPIC-262 (SLICE-262-4): WP profile v1 — adapted selection over the
// envelope vocabulary (D-PROD-Q16): 22 readiness + 15 exposure rules.
// Facts keys (facts.ai_agents_blocked, .blocked_uas, .sitemaps,
// .non_empty, .latest_lastmod_days, .has_jsonld, .namespaces,
// .directory_listing, .sql_error) are collector conventions — the
// contract shape is document_fact.facts (record), the KEYS live here.

import type { IntelRule, IntelRuleset } from "./types";
import { DECLARATION_RULES } from "./declaration-rules";
import {
  docWhere,
  fileWhere,
  headerOf,
  httpWhere,
  isDocFact,
  isFilePresence,
  isHttpObs,
  isOptionRead,
  isRootUrl,
  optionWhere,
  pathIncludes,
  pathOf,
  pass,
  fail,
  warn,
  presenceRule,
} from "./evaluators";

const R = (
  id: string,
  sev: IntelRule["severity"],
  name: string,
  select: IntelRule["select"],
  evaluate: IntelRule["evaluate"],
): IntelRule => ({
  rule_id: `AB-INTEL-R-${id}`,
  version: "1.0.0",
  surface: "readiness",
  severity: sev,
  name,
  select,
  evaluate,
});

const X = (
  id: string,
  sev: IntelRule["severity"],
  name: string,
  select: IntelRule["select"],
  evaluate: IntelRule["evaluate"],
): IntelRule => ({
  rule_id: `AB-INTEL-X-${id}`,
  version: "1.0.0",
  surface: "exposure",
  severity: sev,
  name,
  select,
  evaluate,
});

const rootObs = httpWhere((p) => isRootUrl(p.url));
const docRobots = docWhere("robots");

type Env = Parameters<IntelRule["evaluate"]>[0][number];
const facts = (e: Env) =>
  (isDocFact(e) ? e.payload.facts : {}) as Record<string, unknown>;
const filePresent = (e: Env) =>
  isFilePresence(e) && e.payload.present === true;

const uaAllowed = (ua: string): IntelRule =>
  R(
    `0${ua === "GPTBot" ? 19 : ua === "ClaudeBot" ? 20 : 21}`,
    "medium",
    `${ua} not blocked`,
    httpWhere((p) => p.ua === ua),
    (m) =>
      m.some((e) => isHttpObs(e) && e.payload.status < 400)
        ? pass(`${ua} got <400`)
        : fail(`${ua} blocked or errored`),
  );

export const INTEL_WP_PROFILE_V1: IntelRuleset = {
  // 1.1.0 — additive: audit-259 declaration corpus (R-023…R-027)
  ruleset_version: "1.1.0",
  rules: [
    // ─── readiness ────────────────────────────────────────────────
    R("001", "critical", "homepage reachable", rootObs, (m) =>
      m.some((e) => isHttpObs(e) && e.payload.status < 400)
        ? pass("homepage returns <400")
        : fail("homepage unreachable")),
    R("002", "high", "served over https", rootObs, (m) =>
      m.some((e) => isHttpObs(e) && e.payload.url.startsWith("https://"))
        ? pass("https")
        : fail("plain http")),
    presenceRule({
      surface: "readiness", id: "AB-INTEL-R-003", severity: "high",
      name: "robots.txt present", docType: "robots",
      paths: ["/robots.txt"],
      passReason: "robots.txt served", failReason: "robots.txt 404",
    }),
    R("004", "high", "robots does not block AI agents", docRobots, (m) =>
      m.some((e) => facts(e).ai_agents_blocked === true)
        ? fail("robots disallows AI agents")
        : pass("no blanket AI block")),
    R("005", "medium", "GPTBot allowed", docRobots, (m) =>
      m.some((e) =>
        (facts(e).blocked_uas as string[] | undefined)?.includes("GPTBot"),
      )
        ? fail("GPTBot disallowed")
        : pass("GPTBot allowed")),
    R("006", "medium", "ClaudeBot allowed", docRobots, (m) =>
      m.some((e) =>
        (facts(e).blocked_uas as string[] | undefined)?.includes("ClaudeBot"),
      )
        ? fail("ClaudeBot disallowed")
        : pass("ClaudeBot allowed")),
    presenceRule({
      surface: "readiness", id: "AB-INTEL-R-007", severity: "high",
      name: "llms.txt present", docType: "llms_txt",
      paths: ["/llms.txt"],
      passReason: "llms.txt served", failReason: "llms.txt 404",
    }),
    R("008", "medium", "llms.txt non-empty", docWhere("llms_txt"), (m) =>
      m.some((e) => facts(e).non_empty === true)
        ? pass("llms.txt has content")
        : fail("llms.txt empty or unreported")),
    R("009", "high", "sitemap discoverable", (e) =>
      docWhere("sitemap")(e) ||
      docWhere("robots", (p) => Array.isArray(p.facts.sitemaps))(e) ||
      httpWhere((o) => pathOf(o.url) === "/sitemap.xml")(e), (m) => {
      const robotsLinked = m.some(
        (e) =>
          isDocFact(e) &&
          e.payload.doc_type === "robots" &&
          (e.payload.facts.sitemaps as unknown[] | undefined)?.length,
      );
      if (
        robotsLinked ||
        m.some((e) => docWhere("sitemap")(e)) ||
        m.some((e) => isHttpObs(e) && e.payload.status < 400)
      )
        return pass("sitemap reachable");
      if (m.some((e) => isHttpObs(e) && e.payload.status >= 400))
        return fail("sitemap.xml 404");
      return fail("no sitemap discovered");
    }),
    R("010", "medium", "sitemap freshness", docWhere("sitemap"), (m) => {
      for (const e of m) {
        const d = facts(e).latest_lastmod_days;
        if (typeof d === "number") {
          return d <= 90 ? pass(`lastmod ${d}d ago`) : warn(`stale ${d}d`);
        }
      }
      return warn("no lastmod reported");
    }),
    R("011", "medium", "well-known agent card", docWhere("well_known"), () =>
      pass("well-known document present")),
    R("012", "medium", "html content type", rootObs, (m) =>
      m.some(
        (e) =>
          isHttpObs(e) && (e.payload.content_type ?? "").includes("text/html"),
      )
        ? pass("text/html")
        : fail("non-html homepage")),
    R("013", "high", "no auth wall", rootObs, (m) =>
      m.some((e) => isHttpObs(e) && [401, 403].includes(e.payload.status))
        ? fail("401/403 on homepage")
        : pass("publicly readable")),
    R("014", "medium", "wp-json reachable", httpWhere((p) =>
      pathOf(p.url) === "/wp-json/" || pathOf(p.url) === "/wp-json"), (m) =>
      m.some((e) => isHttpObs(e) && e.payload.status < 400)
        ? pass("REST index served")
        : fail("wp-json unreachable")),
    R("015", "medium", "wp-json namespaces", docWhere("other", (p) =>
      pathIncludes("/wp-json/")(p.url) &&
      Array.isArray(p.facts.namespaces)), (m) =>
      m.some(
        (e) =>
          isDocFact(e) &&
          (e.payload.facts.namespaces as unknown[]).length > 0,
      )
        ? pass("namespaces listed")
        : fail("no namespaces")),
    R("016", "low", "body fetched", rootObs, (m) =>
      m.some((e) => isHttpObs(e) && e.payload.content_hash)
        ? pass("content hash present")
        : warn("no body captured")),
    R("017", "medium", "no 5xx on scanned urls", isHttpObs, (m) =>
      m.some((e) => isHttpObs(e) && e.payload.status >= 500)
        ? fail("server error observed")
        : pass("no 5xx")),
    R("018", "low", "json-ld structured data", docWhere("other", (p) =>
      typeof p.facts.has_jsonld === "boolean"), (m) =>
      m.some((e) => facts(e).has_jsonld === true)
        ? pass("json-ld present")
        : fail("no json-ld")),
    uaAllowed("GPTBot"),
    uaAllowed("ClaudeBot"),
    uaAllowed("AgentBadge-Probe"),
    R("022", "low", "sitemap linked from robots", docRobots, (m) =>
      m.some(
        (e) => (facts(e).sitemaps as unknown[] | undefined)?.length,
      )
        ? pass("Sitemap: directive present")
        : warn("no Sitemap directive")),

    // ─── exposure ─────────────────────────────────────────────────
    X("001", "critical", "debug.log exposed", fileWhere((p) =>
      p.path.endsWith("debug.log")), (m) =>
      m.some((e) => filePresent(e))
        ? fail("debug.log publicly reachable")
        : pass("debug.log absent")),
    X("002", "critical", ".env exposed", fileWhere((p) =>
      /(^|\/)\.env(\.|$)/.test(p.path)), (m) =>
      m.some((e) => filePresent(e))
        ? fail(".env publicly reachable")
        : pass(".env absent")),
    X("003", "high", "xmlrpc enabled", httpWhere((p) =>
      pathOf(p.url) === "/xmlrpc.php"), (m) =>
      m.some((e) => isHttpObs(e) && e.payload.status < 400)
        ? fail("xmlrpc.php answers")
        : pass("xmlrpc.php blocked/absent")),
    X("004", "high", "rest users enumeration", httpWhere((p) =>
      pathOf(p.url).startsWith("/wp-json/wp/v2/users")), (m) =>
      m.some((e) => isHttpObs(e) && e.payload.status < 400)
        ? fail("wp/v2/users lists accounts")
        : pass("users endpoint closed")),
    X("005", "medium", "generator version leak", isHttpObs, (m) =>
      m.some(
        (e) => isHttpObs(e) && headerOf(e.payload, "x-generator") !== undefined,
      )
        ? fail("X-Generator disclosed")
        : pass("no generator header")),
    X("006", "high", "backup files exposed", fileWhere((p) =>
      /\.(sql|bak|zip|tar|gz|old)$/i.test(p.path)), (m) =>
      m.some((e) => filePresent(e))
        ? fail("backup artifact reachable")
        : pass("no backup artifacts")),
    X("007", "critical", "wp-config backup exposed", fileWhere((p) =>
      /wp-config\.(php\.bak|txt|old|php~)$/.test(p.path)), (m) =>
      m.some((e) => filePresent(e))
        ? fail("wp-config backup reachable")
        : pass("wp-config backups absent")),
    X("008", "medium", "uploads directory listing", (e) =>
      httpWhere((p) => pathOf(p.url) === "/wp-content/uploads/")(e) ||
      docWhere("other", (p) => p.facts.directory_listing === true)(e), (m) => {
      if (m.some((e) => isDocFact(e))) return fail("directory listing on");
      if (m.some((e) => isHttpObs(e) && e.payload.status === 200))
        return warn("uploads/ returns 200");
      return pass("uploads/ closed");
    }),
    X("009", "high", "WP_DEBUG enabled", optionWhere((p) =>
      /^WP_DEBUG(_LOG)?$/.test(p.name)), (m) =>
      m.some(
        (e) =>
          isOptionRead(e) && Boolean(e.payload.value) === true,
      )
        ? fail("WP_DEBUG truthy")
        : pass("debug off")),
    X("010", "low", "readme.html exposed", fileWhere((p) =>
      p.path === "/readme.html"), (m) =>
      m.some((e) => filePresent(e))
        ? fail("readme.html reachable")
        : pass("readme absent")),
    X("011", "high", "phpinfo exposed", fileWhere((p) =>
      /(phpinfo|info|test)\.php$/.test(p.path)), (m) =>
      m.some((e) => filePresent(e))
        ? fail("phpinfo reachable")
        : pass("no phpinfo")),
    X("012", "medium", "cors wildcard", isHttpObs, (m) =>
      m.some(
        (e) =>
          isHttpObs(e) &&
          headerOf(e.payload, "access-control-allow-origin") === "*",
      )
        ? fail("Access-Control-Allow-Origin: *")
        : pass("no wildcard cors")),
    X("013", "medium", "server version leak", isHttpObs, (m) =>
      m.some(
        (e) =>
          isHttpObs(e) && /\d+\.\d+/.test(headerOf(e.payload, "server") ?? ""),
      )
        ? fail("Server header discloses version")
        : pass("server header clean")),
    X("014", "medium", "plugin path enumerable", fileWhere((p) =>
      p.path.startsWith("/wp-content/plugins/")), (m) =>
      m.some((e) => filePresent(e))
        ? fail("plugin files reachable")
        : pass("plugin paths closed")),
    // selector: any doc fact carrying a sql_error boolean — the rule
    // must be able to PASS on a clean page, not only fail on a leak
    X("015", "critical", "sql error leak", docWhere("other", (p) =>
      typeof p.facts.sql_error === "boolean"), (m) =>
      m.some((e) => facts(e).sql_error === true)
        ? fail("database error text leaked")
        : pass("no sql error text")),

    ...DECLARATION_RULES, // audit-259 declaration-consistency corpus
  ],
};
