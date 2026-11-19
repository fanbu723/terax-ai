/**
 * Contract test for the AI SDK behavior the permission modes rely on:
 * `needsApproval` may be a per-call function, and the SDK must execute the
 * call without an approval request when it returns false. An SDK upgrade
 * that breaks this would silently turn allow-all/assisted into manual mode,
 * so pin it here rather than trusting the type definition.
 */

import { generateText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it } from "vitest";
import { z } from "zod";

function toolCallModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-1",
          toolName: "ping",
          input: '{"value":"x"}',
        },
      ],
      finishReason: { unified: "tool-calls" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

const pingTool = {
  ping: tool({
    inputSchema: z.object({ value: z.string() }),
    needsApproval: () => false,
    execute: async ({ value }) => ({ echoed: value }),
  }),
};

const gatedPingTool = {
  ping: tool({
    inputSchema: z.object({ value: z.string() }),
    needsApproval: () => true,
    execute: async ({ value }) => ({ echoed: value }),
  }),
};

it("executes without an approval request when needsApproval returns false", async () => {
  const result = await generateText({
    model: toolCallModel(),
    prompt: "go",
    tools: pingTool,
    stopWhen: ({ steps }) => steps.length >= 2,
  });
  expect(JSON.stringify(result.steps)).toContain('"echoed":"x"');
});

it("pauses for approval when needsApproval returns true", async () => {
  const result = await generateText({
    model: toolCallModel(),
    prompt: "go",
    tools: gatedPingTool,
    stopWhen: ({ steps }) => steps.length >= 1,
  });
  expect(JSON.stringify(result.steps)).toContain("approval");
});
