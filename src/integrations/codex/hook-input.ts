import type { ToolCall } from "../../entities/tool-call";
import type { PromptSubmission } from "../../storage/tables/prompts";
export function codexPromptId(sessionId: string, turnId: string): string {
  return `codex:${sessionId}:${turnId}`;
}
export function toPrompt(input: unknown): PromptSubmission {
  const p = input as { session_id?: string; turn_id?: string; prompt?: string; cwd?: string };
  if (
    typeof p?.session_id !== "string" ||
    !p.session_id ||
    typeof p.turn_id !== "string" ||
    !p.turn_id ||
    typeof p.prompt !== "string"
  )
    throw new Error("Incomplete Codex prompt payload");
  return {
    promptId: codexPromptId(p.session_id, p.turn_id),
    sessionId: p.session_id,
    integration: "codex",
    text: p.prompt,
    project: p.cwd,
  };
}
export interface CodexHookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  turn_id?: string;
  transcript_path?: string | null;
  agent_id?: string;
  model?: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
  tool_response?: unknown;
  source?: string;
}
export function patchToolInput(command: unknown): {
  toolName: "MultiEdit";
  toolInput: { command: string; file_paths: string[]; deleted_paths: string[] };
} {
  if (typeof command !== "string") throw new Error("Missing patch command");
  const lines = command.replace(/\r\n/g, "\n").trim().split("\n");
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") throw new Error("Invalid patch envelope");
  const paths = lines.flatMap((line) => {
    const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    return match ? [match[1]] : [];
  });
  if (!paths.length) throw new Error("Patch contains no paths");
  const deletedPaths = lines.flatMap((line) => {
    const match = /^\*\*\* Delete File: (.+)$/.exec(line);
    return match ? [match[1]] : [];
  });
  return { toolName: "MultiEdit", toolInput: { command, file_paths: paths, deleted_paths: deletedPaths } };
}
export function toToolCall(input: CodexHookInput): ToolCall {
  if (!input.session_id || !input.tool_use_id || !input.tool_name || !input.cwd) throw new Error("Incomplete Codex hook payload");
  const { toolName, toolInput } =
    input.tool_name === "apply_patch"
      ? patchToolInput((input.tool_input as { command?: unknown })?.command)
      : { toolName: input.tool_name, toolInput: input.tool_input };
  return {
    integration: "codex",
    toolUseId: `codex:${input.session_id}:${input.tool_use_id}`,
    toolName,
    toolInput,
    cwd: input.cwd,
    sessionId: input.session_id,
    promptId: input.turn_id ? codexPromptId(input.session_id, input.turn_id) : undefined,
    agentId: input.agent_id,
    model: input.model || undefined,
    // Codex's transcript format is not a stable hook interface. Do not parse it as Claude JSONL.
  };
}
