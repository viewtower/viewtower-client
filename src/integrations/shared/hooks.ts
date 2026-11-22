import { beforeToolCall, beforeToolCallFailed, afterToolCall, onContextReset } from "../../services/gateway";
import { logError } from "../../helpers/errors";
import type { Integration } from "..";
import { readHookInput, reply } from "./hook-io";
import { recordPrompt } from "../../storage/tables/prompts";
import { maybeSync, maybeUploadActivity } from "../../services/company/sync";
import { ensureDashboard } from "../../dashboard/autostart";
export async function runIntegrationHook(phase: string, integration: Integration): Promise<void> {
  if (phase === "pre") {
    let outcome;
    try {
      outcome = beforeToolCall(integration.toToolCall(await readHookInput()));
    } catch (err) {
      outcome = beforeToolCallFailed(err);
    }
    reply(integration.preReply(outcome));
  } else if (phase === "post") {
    try {
      const input = await readHookInput<{
        hook_event_name?: string;
        tool_response?: unknown;
        error?: unknown;
        duration_ms?: number;
      }>();
      // A failed call's output (in `error`) can't be replaced: log it unreduced, so it completes with its tokens.
      const failed = input.hook_event_name === "PostToolUseFailure";
      const outcome = afterToolCall(
        integration.toToolCall(input),
        { response: failed ? input.error : input.tool_response, durationMs: input.duration_ms },
        failed ? { ...integration.capabilities, replaceOutput: false } : integration.capabilities
      );
      reply(failed ? undefined : integration.postReply(outcome));
    } catch (err) {
      logError("hook:post", err);
      reply();
    }
  } else if (phase === "prompt") {
    try {
      const input = await readHookInput();
      if (integration.toPrompt) recordPrompt(integration.toPrompt(input));
    } catch (err) {
      logError("hook:prompt", err);
    }
    await maybeUploadActivity(); // activity only (rules sync at session start); throttled, never throws
    reply();
  } else {
    let opened = false;
    try {
      const input = await readHookInput<{ session_id?: string; hook_event_name?: string; source?: string }>();
      if (input.session_id && (input.hook_event_name === "PreCompact" || input.source === "compact" || input.source === "clear"))
        onContextReset(input.session_id);
      // Agent opened (startup/resume, or Codex without a source): always sync, no throttle.
      opened = input.hook_event_name === "SessionStart" && input.source !== "compact" && input.source !== "clear";
    } catch (err) {
      logError("hook:session", err);
    }
    await maybeSync(integration, opened);
    await ensureDashboard();
    reply();
  }
}
