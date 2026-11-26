import type { ToolCall } from "../entities/tool-call";
import type { GatewayCapabilities, AfterToolCall, BeforeToolCall } from "../services/gateway";
import * as claudeSettings from "./claude/settings";
import * as codexSettings from "./codex/settings";
import * as opencodeSettings from "./opencode/settings";
import { toToolCall as claudeCall, toPrompt as claudePrompt, type ClaudeToolHookInput } from "./claude/hook-input";
import { toToolCall as codexCall, toPrompt as codexPrompt, type CodexHookInput } from "./codex/hook-input";
import { toToolCall as opencodeCall, toPrompt as opencodePrompt, type OpencodeHookInput } from "./opencode/hook-input";
import type { PromptSubmission } from "../storage/tables/prompts";
import { displayPrompt } from "./codex/prompt-display";
import { promptInfo, type PromptInfo } from "./claude/transcript";
export interface Integration {
  displayPrompt?(text: string): string;
  toPrompt?(input: unknown): PromptSubmission;
  setupNotes?: string;
  promptInfo(path: string | null, promptId: string): PromptInfo | null;
  name: string;
  capabilities: GatewayCapabilities;
  installHooks: typeof claudeSettings.installHooks;
  uninstallHooks: typeof claudeSettings.uninstallHooks;
  hooksInstalled: typeof claudeSettings.hooksInstalled;
  toToolCall(input: unknown): ToolCall;
  preReply(outcome: BeforeToolCall): Record<string, unknown> | undefined;
  postReply(outcome: AfterToolCall): Record<string, unknown> | undefined;
}
const preReply: Integration["preReply"] = (outcome) =>
  outcome.block
    ? { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: outcome.block }
    : undefined;
const postReply: Integration["postReply"] = (outcome) =>
  outcome.updatedResponse !== undefined
    ? {
        hookEventName: "PostToolUse",
        updatedToolOutput: outcome.updatedResponse,
      }
    : undefined;
const integrations: Record<string, Integration> = {
  claude: {
    toPrompt: claudePrompt,
    promptInfo,
    name: "Claude Code",
    capabilities: {},
    ...claudeSettings,
    toToolCall: (input) => claudeCall(input as ClaudeToolHookInput),
    preReply,
    postReply,
  },
  codex: {
    displayPrompt,
    toPrompt: codexPrompt,
    setupNotes:
      "Review and trust the hooks in Codex before they run. Input/output reduction is unavailable for this integration.",
    promptInfo: () => null,
    name: "Codex",
    capabilities: { replaceOutput: false },
    ...codexSettings,
    toToolCall: (input) => codexCall(input as CodexHookInput),
    preReply,
    postReply: () => undefined,
  },
  opencode: {
    toPrompt: opencodePrompt,
    promptInfo: () => null,
    name: "opencode",
    capabilities: {},
    ...opencodeSettings,
    toToolCall: (input) => opencodeCall(input as OpencodeHookInput),
    preReply,
    postReply,
  },
};
export function integrationFor(id?: string): Integration {
  if (!id) throw new Error('An explicit "--agent claude|codex|opencode" is required.');
  const integration = Object.hasOwn(integrations, id) ? integrations[id] : undefined;
  if (!integration) throw new Error(`Unknown agent "${id}". Choose claude, codex or opencode.`);
  return integration;
}
