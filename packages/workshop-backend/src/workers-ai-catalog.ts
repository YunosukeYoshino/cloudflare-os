import type {Api, Model} from "@earendil-works/pi-ai";
import {CLOUDFLARE_WORKERS_AI_MODELS} from "@earendil-works/pi-ai/providers/cloudflare-workers-ai.models";
import {WORKERS_AI_OUTPUT_LIMIT} from "@gadgets/workshop-shared/api";

// Workers AI counts the requested response cap against the model window together with the
// prompt, so leave headroom for at least a minimal agent system prompt + user turn.
const MIN_PROMPT_RESERVE = 4096;

const catalog = CLOUDFLARE_WORKERS_AI_MODELS as Record<string, Model<Api>>;

/**
 * Resolve a hand-entered Workers AI model id to pi's catalog entry. Accepts the canonical
 * `@cf/...` id or a unique substring such as `llama-3.3`.
 */
export function lookupWorkersAiCatalogModel(modelId: string): Model<Api> | undefined {
  if (catalog[modelId]) return catalog[modelId];
  const needle = modelId.trim().toLowerCase().replace(/^@cf\//, "");
  if (!needle) return undefined;
  const matches = Object.entries(catalog).filter(([id]) => {
    const hay = id.toLowerCase();
    return hay === needle || hay.includes(needle) || hay.endsWith(`/${needle}`);
  });
  if (matches.length === 1) return matches[0][1];
  return undefined;
}

/**
 * Safe Workers AI output cap: never consume the entire context window as completion budget.
 */
export function workersAiOutputTokenCap(
    catalogEntry: Model<Api> | undefined,
    requested?: number,
): number | undefined {
  if (requested === undefined && !catalogEntry) return undefined;
  let cap = requested ?? catalogEntry?.maxTokens ??
      (catalogEntry ? undefined : WORKERS_AI_OUTPUT_LIMIT);
  if (cap === undefined) return undefined;
  const window = catalogEntry?.contextWindow;
  if (window !== undefined) {
    cap = Math.min(cap, window - MIN_PROMPT_RESERVE);
    if (catalogEntry?.maxTokens !== undefined) {
      cap = Math.min(cap, catalogEntry.maxTokens);
    }
  } else {
    // Unknown Workers AI model id: stay conservative until the catalog supplies a window.
    cap = Math.min(cap, 16_384);
  }
  return Math.max(cap, 256);
}
