import type { ToolCall } from "../../entities/tool-call";
import { latestPromptId, type PromptSubmission } from "../../storage/tables/prompts";
import { patchToolInput } from "../codex/hook-input";

// Payloads sent by the generated opencode plugin (Claude-shaped), translated into the gateway's ToolCall.

export function toPrompt(input: unknown): PromptSubmission {
  const p = input as { session_id?: string; prompt_id?: string; prompt?: string; cwd?: string };
  if (
    typeof p?.session_id !== "string" ||
    !p.session_id ||
    typeof p.prompt_id !== "string" ||
    !p.prompt_id ||
    typeof p.prompt !== "string"
  )
    throw new Error("Incomplete opencode prompt payload");
  return {
    promptId: `opencode:${p.session_id}:${p.prompt_id}`,
    sessionId: p.session_id,
    integration: "opencode",
    text: p.prompt,
    project: p.cwd,
  };
}
export interface OpencodeHookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
  tool_response?: unknown;
  model?: string;
}
// opencode tool names and args (2.x: shell/path/patch; 1.x: bash/filePath/apply_patch), mapped to the
// Claude names the services understand. Others pass through.
function mapTool(name: string, args: unknown): { toolName: string; toolInput: unknown } {
  const a = (args ?? {}) as Record<string, unknown>;
  const file_path = a.path ?? a.filePath;
  switch (name) {
    case "shell":
    case "bash":
      return { toolName: "Bash", toolInput: args };
    case "read":
      return { toolName: "Read", toolInput: { file_path, offset: a.offset, limit: a.limit } };
    case "write":
      return { toolName: "Write", toolInput: { file_path, content: a.content } };
    case "edit":
      return {
        toolName: "Edit",
        toolInput: { file_path, old_string: a.oldString, new_string: a.newString, replace_all: a.replaceAll },
      };
    case "grep":
      return { toolName: "Grep", toolInput: { pattern: a.pattern, path: a.path, glob: a.include } };
    case "glob":
      return { toolName: "Glob", toolInput: { pattern: a.pattern, path: a.path } };
    case "list":
      return { toolName: "Glob", toolInput: { path: a.path } };
    case "question":
      return { toolName: "AskUserQuestion", toolInput: args };
    case "webfetch":
      return { toolName: "WebFetch", toolInput: { url: a.url } };
    case "patch":
    case "apply_patch":
      return patchToolInput(a.patchText);
    default:
      return { toolName: name, toolInput: args };
  }
}
export function toToolCall(input: OpencodeHookInput): ToolCall {
  if (!input.session_id || !input.tool_use_id || !input.tool_name || !input.cwd)
    throw new Error("Incomplete opencode hook payload");
  return {
    integration: "opencode",
    toolUseId: `opencode:${input.session_id}:${input.tool_use_id}`,
    ...mapTool(input.tool_name, input.tool_input),
    cwd: input.cwd,
    sessionId: input.session_id,
    promptId: latestPromptId(input.session_id, "opencode"),
    model: input.model || undefined,
  };
}
