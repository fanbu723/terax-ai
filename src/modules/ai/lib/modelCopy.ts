import type { TFunction } from "@/i18n";

// Built-in model catalog copy lives in `config.ts` as English data. The
// dictionary checker only recognises literal `t()` calls, so every built-in
// hint and description is mapped explicitly here instead of calling
// `t(model.description)` at render time. Custom endpoints keep their
// user-provided name and URL untouched: the fallback returns the raw string.

export function modelHintLabel(hint: string, t: TFunction): string {
  switch (hint) {
    case "Balanced":
      return t("Balanced");
    case "Best":
      return t("Best");
    case "Cheap":
      return t("Cheap");
    case "Code":
      return t("Code");
    case "Coding":
      return t("Coding");
    case "Configurable":
      return t("Configurable");
    case "Fast":
      return t("Fast");
    case "Fastest":
      return t("Fastest");
    case "Flagship":
      return t("Flagship");
    case "Frontier":
      return t("Frontier");
    case "Legacy":
      return t("Legacy");
    case "Lite":
      return t("Lite");
    case "Local":
      return t("Local");
    case "Max":
      return t("Max");
    case "Previous":
      return t("Previous|model");
    case "Reasoning":
      return t("Reasoning");
    case "Stable":
      return t("Stable");
    case "Thinking":
      return t("Thinking");
    case "Ultra-fast":
      return t("Ultra-fast");
    case "Versatile":
      return t("Versatile");
    default:
      return hint;
  }
}

export function modelDescriptionLabel(
  description: string,
  t: TFunction,
): string {
  switch (description) {
    case "Anthropic's most capable model for complex reasoning and long-horizon agentic coding.":
      return t(
        "Anthropic's most capable model for complex reasoning and long-horizon agentic coding.",
      );
    case "Any OpenAI-compatible endpoint.":
      return t("Any OpenAI-compatible endpoint.");
    case "Any model on OpenRouter by id.":
      return t("Any model on OpenRouter by id.");
    case "Apple-silicon models via mlx_lm.server.":
      return t("Apple-silicon models via mlx_lm.server.");
    case "Best combination of Claude intelligence and speed.":
      return t("Best combination of Claude intelligence and speed.");
    case "Bulk throughput at low cost.":
      return t("Bulk throughput at low cost.");
    case "Chain-of-thought at open-weight prices.":
      return t("Chain-of-thought at open-weight prices.");
    case "Cheap and fast everyday tier.":
      return t("Cheap and fast everyday tier.");
    case "Cheaper Grok 4 with vision and reasoning.":
      return t("Cheaper Grok 4 with vision and reasoning.");
    case "Extremely fast, cheap, and lightweight multimodal model.":
      return t("Extremely fast, cheap, and lightweight multimodal model.");
    case "Fast and broadly capable.":
      return t("Fast and broadly capable.");
    case "Fast multimodal, 1M context.":
      return t("Fast multimodal, 1M context.");
    case "Fast tier for chat and tools.":
      return t("Fast tier for chat and tools.");
    case "Fast, affordable reasoning for high-volume work.":
      return t("Fast, affordable reasoning for high-volume work.");
    case "Fast, cheap, and lightweight multimodal model.":
      return t("Fast, cheap, and lightweight multimodal model.");
    case "Fastest inference on Cerebras silicon.":
      return t("Fastest inference on Cerebras silicon.");
    case "Flagship Mistral model with 128K context.":
      return t("Flagship Mistral model with 128K context.");
    case "Frontier coding, agentic, and knowledge-work model.":
      return t("Frontier coding, agentic, and knowledge-work model.");
    case "Frontier model for complex professional and agentic work.":
      return t("Frontier model for complex professional and agentic work.");
    case "Frontier reasoning and code.":
      return t("Frontier reasoning and code.");
    case "Frontier reasoning with extended thinking.":
      return t("Frontier reasoning with extended thinking.");
    case "Good balance of speed and intelligence.":
      return t("Good balance of speed and intelligence.");
    case "High-intelligence, extremely fast multimodal model.":
      return t("High-intelligence, extremely fast multimodal model.");
    case "Highest-accuracy version for the hardest professional and agentic tasks.":
      return t(
        "Highest-accuracy version for the hardest professional and agentic tasks.",
      );
    case "Local GGUF models via LM Studio.":
      return t("Local GGUF models via LM Studio.");
    case "Local models via Ollama.":
      return t("Local models via Ollama.");
    case "Meta's open model on wafer-scale silicon.":
      return t("Meta's open model on wafer-scale silicon.");
    case "Most capable Claude for demanding reasoning and long-horizon agentic work.":
      return t(
        "Most capable Claude for demanding reasoning and long-horizon agentic work.",
      );
    case "Most intelligent and fastest Grok. Strong agentic tool use and 1M context.":
      return t(
        "Most intelligent and fastest Grok. Strong agentic tool use and 1M context.",
      );
    case "Multilingual model at extreme speed.":
      return t("Multilingual model at extreme speed.");
    case "Previous-gen Opus.":
      return t("Previous-gen Opus.");
    case "Previous-gen flagship for long reasoning.":
      return t("Previous-gen flagship for long reasoning.");
    case "Production-stable Gemini.":
      return t("Production-stable Gemini.");
    case "Purpose-built coding model from Mistral.":
      return t("Purpose-built coding model from Mistral.");
    case "Quick, cheap, multimodal.":
      return t("Quick, cheap, multimodal.");
    case "Reasoning-distilled Llama on Groq.":
      return t("Reasoning-distilled Llama on Groq.");
    case "Snappy default at low cost.":
      return t("Snappy default at low cost.");
    case "Specialized fast coding model for agentic workflows (powers Grok Build CLI).":
      return t(
        "Specialized fast coding model for agentic workflows (powers Grok Build CLI).",
      );
    case "Strong intelligence with lower cost and latency.":
      return t("Strong intelligence with lower cost and latency.");
    case "Strong open-weight code model.":
      return t("Strong open-weight code model.");
    case "Strong reasoning with the latest features and decent speed.":
      return t("Strong reasoning with the latest features and decent speed.");
    case "Strong reasoning, 1M context.":
      return t("Strong reasoning, 1M context.");
    case "Sub-second responses on Groq LPU.":
      return t("Sub-second responses on Groq LPU.");
    case "Sweet spot of quality and speed.":
      return t("Sweet spot of quality and speed.");
    case "Tiny and instant — great for autocomplete.":
      return t("Tiny and instant — great for autocomplete.");
    case "Tuned for code and tool use.":
      return t("Tuned for code and tool use.");
    case "Ultra-cheap workhorse for bulk tasks.":
      return t("Ultra-cheap workhorse for bulk tasks.");
    default:
      return description;
  }
}
