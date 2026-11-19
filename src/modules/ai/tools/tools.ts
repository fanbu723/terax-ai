import { buildManagedAgentTools } from "./agent";
import { buildEditTools } from "./edit";
import { buildFsTools } from "./fs";
import { buildSearchTools } from "./search";
import { buildShellTools } from "./shell";
import { buildSubagentTools } from "./subagent";
import { buildTerminalTools } from "./terminal";
import { buildTodoTools } from "./todo";

export { resolvePath, type ToolContext } from "./context";

/**
 * AI tool definitions.
 *
 * Approval policy:
 *  - Read-only tools (`read_file`, `list_directory`, `grep`, `glob`)
 *    auto-execute, but go through the security guard which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.).
 *  - Mutating tools (`write_file`, `edit`, `multi_edit`, `create_directory`,
 *    `bash_run`, `bash_background`, `spawn_coding_agent`, `send_to_agent`)
 *    go through `lib/approvalGate.ts`, which decides per call from the
 *    session's permission mode: manual always asks, assisted asks unless
 *    `lib/risk.ts` rates the call low-risk, allow-all never asks. Asking
 *    surfaces a `tool-approval-request` part that the UI renders as a
 *    confirmation card. `lib/security.ts` hard blocks apply in every mode.
 *  - `edit` / `multi_edit` additionally enforce a read-before-edit invariant
 *    (the model must have called read_file on the path earlier in the
 *    session).
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */
export function buildTools(ctx: import("./context").ToolContext) {
  return {
    ...buildFsTools(ctx),
    ...buildEditTools(ctx),
    ...buildSearchTools(ctx),
    ...buildShellTools(ctx),
    ...buildSubagentTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildTodoTools(ctx),
    ...buildManagedAgentTools(ctx),
  } as const;
}
