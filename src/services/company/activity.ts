import { sql } from "../../storage/database";
import { getSetting } from "../../storage/tables/settings";
import { post } from "./api";
import type { CompanyConfig } from "./sync";

// Tool activity upload: metadata of logged tool calls (never the tool input or result) goes to the
// company server, limited to the decisions the company opted into. Runs inside the throttled sync.

const BATCH = 500; // ponytail: one batch per sync tick, a backlog drains over later ticks; loop if that is too slow

const APPROVED = ["allowed", "observed"];
const DENIED = ["denied", "would_deny"];

interface ActivityRow {
  id: number;
  tool_use_id: string;
  session_id: string | null;
  agent: string;
  tool_name: string;
  decision: string;
  rule: string | null;
  occurred_at: string | null;
  original_result_tokens: number | null;
  actual_result_tokens: number | null;
}

/** Starts uploads from now: calls logged before the login are never sent. */
export function markAllActivitySynced(): void {
  sql(`UPDATE tool_calls SET synced = 1 WHERE synced = 0`).run();
}

/**
 * Uploads the next batch of unsynced, finished calls. Must run before the rules sync replaces the local
 * rules, or matched rules of not-yet-uploaded calls are gone (sent as null).
 */
export async function uploadActivity(): Promise<number> {
  const config = getSetting("company:config");
  if (!config) return 0;
  const cfg = JSON.parse(config) as CompanyConfig;
  const decisions = [...(cfg.sync_approved_activities ? APPROVED : []), ...(cfg.sync_denied_activities ? DENIED : [])];

  // Finished calls only, so their result tokens are known. Denied calls never run, so they never finish.
  // A call that never finishes (session killed mid-call) is never sent.
  const rows = sql(
    `SELECT c.id, c.tool_use_id, c.session_id, c.integration AS agent, c.tool_name, c.decision, r.rule,
            COALESCE(c.started_at, c.completed_at) AS occurred_at,
            c.result_tokens AS original_result_tokens, c.result_tokens_after AS actual_result_tokens
       FROM tool_calls c LEFT JOIN tool_rules r ON r.id = c.rule_id
      WHERE c.synced = 0 AND (c.completed_at IS NOT NULL OR c.decision = 'denied')
      ORDER BY c.id LIMIT ?`
  ).all(BATCH) as unknown as ActivityRow[];
  if (!rows.length) return 0;

  const events = rows
    .filter((r) => decisions.includes(r.decision))
    .map(({ id: _id, occurred_at, ...r }) => ({ ...r, occurred_at: occurred_at ?? new Date().toISOString() }));
  if (events.length) await post("/client/activity", { events }, true);
  // Skipped (not opted-in) calls are marked too: they are never sent, even if the company opts in later.
  const ids = rows.map((r) => r.id);
  sql(`UPDATE tool_calls SET synced = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  return events.length;
}
