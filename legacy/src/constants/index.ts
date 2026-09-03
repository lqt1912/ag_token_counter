import * as path from 'path';
import * as os from 'os';

/**
 * Extension namespace identifier
 */
export const EXTENSION_ID = 'antigravityTokenCounter';

/**
 * Command identifier constants
 */
export const COMMANDS = {
  SHOW_STATS: 'antigravityTokenCounter.showStats',
  RESET_SESSION: 'antigravityTokenCounter.resetSession',
  EXPORT_REPORT: 'antigravityTokenCounter.exportReport',
  REFRESH_WATCHER: 'antigravityTokenCounter.refreshWatcher',
} as const;

/**
 * Configuration property keys
 */
export const CONFIG_KEYS = {
  BRAIN_PATH: 'antigravityTokenCounter.brainPath',
  MODEL_PRICING: 'antigravityTokenCounter.modelPricing',
  CUSTOM_INPUT_COST: 'antigravityTokenCounter.customInputCostPerMillion',
  CUSTOM_OUTPUT_COST: 'antigravityTokenCounter.customOutputCostPerMillion',
  STATUS_BAR_FORMAT: 'antigravityTokenCounter.statusBarFormat',
  POLLING_INTERVAL_MS: 'antigravityTokenCounter.pollingIntervalMs',
} as const;

/**
 * Status bar format presets
 */
export const STATUS_BAR_FORMATS = {
  COMPACT: 'compact',
  DETAILED: 'detailed',
  TOTAL_ONLY: 'total-only',
  WITH_COST: 'with-cost',
} as const;

export const DEFAULT_MODEL_KEY = 'gemini-3.7-flash';

// ─────────────────────────────────────────────────────────────────────────────
// Antigravity available models (source: antigravity.google/docs/models, Sep 2026)
// ─────────────────────────────────────────────────────────────────────────────
// 1. Gemini 3.7 Flash  (Medium, Fast)  – default
// 2. Gemini 3.6 Flash  (Medium, Fast)
// 3. Gemini 3.5 Flash  (Medium, Fast)  – intro price
// 4. Gemini 3.1 Pro    (High reasoning, Low speed)
// 5. Claude Sonnet 4.6 (Thinking)
// 6. Claude Opus 4.6   (Thinking)
// 7. GPT-OSS 120B      (Medium – open-source inference)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known model pricing rates per 1,000,000 tokens (in USD).
 * Pricing verified September 2026 from official provider pages.
 */
export const MODEL_PRICING_TABLE: Record<string, { name: string; inputPerMillion: number; outputPerMillion: number }> = {
  // ── Gemini models ─────────────────────────────────────────────────────────
  'gemini-3.7-flash': {
    name: 'Gemini 3.7 Flash',
    inputPerMillion: 0.75,
    outputPerMillion: 3.75,
  },
  'gemini-3.6-flash': {
    name: 'Gemini 3.6 Flash',
    // Introductory pricing valid through Dec 31, 2026.
    // Standard rate from Jan 1, 2027: $1.50/$7.50
    inputPerMillion: 0.75,
    outputPerMillion: 3.75,
  },
  'gemini-3.5-flash': {
    name: 'Gemini 3.5 Flash',
    inputPerMillion: 1.50,
    outputPerMillion: 9.00,
  },
  'gemini-3.1-pro': {
    name: 'Gemini 3.1 Pro',
    inputPerMillion: 2.00,
    outputPerMillion: 12.00,
  },

  // ── Claude models ─────────────────────────────────────────────────────────
  'claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6',
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
  },
  'claude-opus-4-6': {
    name: 'Claude Opus 4.6',
    inputPerMillion: 5.00,
    outputPerMillion: 25.00,
  },

  // ── OpenAI / OSS models ───────────────────────────────────────────────────
  'gpt-oss-120b': {
    name: 'GPT-OSS 120B',
    // Open-source model served via API; estimated inference cost.
    inputPerMillion: 0.90,
    outputPerMillion: 0.90,
  },

  // ── Legacy / fallback entries (kept for historical data compatibility) ─────
  'gemini-2.0-flash': {
    name: 'Gemini 2.0 Flash',
    inputPerMillion: 0.10,
    outputPerMillion: 0.40,
  },
  'gemini-2.0-flash-lite': {
    name: 'Gemini 2.0 Flash Lite',
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-1.5-flash': {
    name: 'Gemini 1.5 Flash',
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-1.5-pro': {
    name: 'Gemini 1.5 Pro',
    inputPerMillion: 1.25,
    outputPerMillion: 5.00,
  },
  'claude-3-7-sonnet': {
    name: 'Claude 3.7 Sonnet',
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
  },
  'claude-3-5-sonnet': {
    name: 'Claude 3.5 Sonnet',
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
  },
  'claude-3-5-haiku': {
    name: 'Claude 3.5 Haiku',
    inputPerMillion: 0.80,
    outputPerMillion: 4.00,
  },
  'claude-3-opus': {
    name: 'Claude 3 Opus',
    inputPerMillion: 15.00,
    outputPerMillion: 75.00,
  },
  'gpt-4o': {
    name: 'GPT-4o',
    inputPerMillion: 2.50,
    outputPerMillion: 10.00,
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    inputPerMillion: 0.15,
    outputPerMillion: 0.60,
  },

  // ── Custom (user-defined) ─────────────────────────────────────────────────
  'custom': {
    name: 'Custom Pricing',
    inputPerMillion: 0.75,
    outputPerMillion: 3.75,
  },
};

/**
 * Resolves a raw model string (e.g. from logs, metadata, or VS Code settings)
 * to matched pricing rates. Priority: exact key → Antigravity current models
 * → legacy models → default fallback.
 *
 * Handles display names like:
 *   "Claude Sonnet 4.6 (Thinking)"
 *   "Claude Opus 4.6 (Thinking)"
 *   "Gemini 3.7 Flash Medium"
 *   "Gemini 3.6 Flash Medium"
 *   "Gemini 3.1 Pro Low"
 *   "GPT-OSS 120B (Medium)"
 */
export function resolveModelPricing(rawNameOrKey?: string): { key: string; name: string; inputPerMillion: number; outputPerMillion: number } {
  if (!rawNameOrKey) {
    const fallback = MODEL_PRICING_TABLE[DEFAULT_MODEL_KEY];
    return { key: DEFAULT_MODEL_KEY, ...fallback };
  }

  const normalized = rawNameOrKey.toLowerCase().trim();

  // ── 1. Direct key lookup (fastest path) ──────────────────────────────────
  if (MODEL_PRICING_TABLE[normalized]) {
    return { key: normalized, ...MODEL_PRICING_TABLE[normalized] };
  }

  // ── 2. Antigravity CURRENT models (highest priority) ─────────────────────

  // Claude Sonnet 4.6 (Thinking) / claude-sonnet-4.6
  if (normalized.includes('claude') && normalized.includes('sonnet') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
    return { key: 'claude-sonnet-4-6', ...MODEL_PRICING_TABLE['claude-sonnet-4-6'] };
  }
  // Claude Opus 4.6 (Thinking) / claude-opus-4.6
  if (normalized.includes('claude') && normalized.includes('opus') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
    return { key: 'claude-opus-4-6', ...MODEL_PRICING_TABLE['claude-opus-4-6'] };
  }
  // Gemini 3.7 Flash
  if (normalized.includes('gemini') && normalized.includes('3.7') && normalized.includes('flash')) {
    return { key: 'gemini-3.7-flash', ...MODEL_PRICING_TABLE['gemini-3.7-flash'] };
  }
  // Gemini 3.6 Flash
  if (normalized.includes('gemini') && normalized.includes('3.6') && normalized.includes('flash')) {
    return { key: 'gemini-3.6-flash', ...MODEL_PRICING_TABLE['gemini-3.6-flash'] };
  }
  // Gemini 3.5 Flash
  if (normalized.includes('gemini') && normalized.includes('3.5') && normalized.includes('flash')) {
    return { key: 'gemini-3.5-flash', ...MODEL_PRICING_TABLE['gemini-3.5-flash'] };
  }
  // Gemini 3.1 Pro
  if (normalized.includes('gemini') && normalized.includes('3.1') && normalized.includes('pro')) {
    return { key: 'gemini-3.1-pro', ...MODEL_PRICING_TABLE['gemini-3.1-pro'] };
  }
  // GPT-OSS 120B – match "gpt-oss", "gpt oss", "120b"
  if (normalized.includes('gpt-oss') || normalized.includes('gpt oss') || normalized.includes('120b')) {
    return { key: 'gpt-oss-120b', ...MODEL_PRICING_TABLE['gpt-oss-120b'] };
  }

  // ── 3. Generic Gemini flash fallback → newest flash available ────────────
  if (normalized.includes('gemini') && normalized.includes('flash')) {
    return { key: 'gemini-3.7-flash', ...MODEL_PRICING_TABLE['gemini-3.7-flash'] };
  }
  // Generic Gemini pro fallback → newest pro
  if (normalized.includes('gemini') && normalized.includes('pro')) {
    return { key: 'gemini-3.1-pro', ...MODEL_PRICING_TABLE['gemini-3.1-pro'] };
  }

  // ── 4. Legacy Claude models (for historical data) ────────────────────────
  // Broader Claude Sonnet (any version) → map to current sonnet
  if (normalized.includes('claude') && normalized.includes('sonnet')) {
    return { key: 'claude-sonnet-4-6', ...MODEL_PRICING_TABLE['claude-sonnet-4-6'] };
  }
  // Broader Claude Opus → map to current opus
  if (normalized.includes('claude') && normalized.includes('opus')) {
    return { key: 'claude-opus-4-6', ...MODEL_PRICING_TABLE['claude-opus-4-6'] };
  }
  if (normalized.includes('haiku')) {
    return { key: 'claude-3-5-haiku', ...MODEL_PRICING_TABLE['claude-3-5-haiku'] };
  }
  if (normalized.includes('claude')) {
    // Generic Claude → default to Sonnet 4.6
    return { key: 'claude-sonnet-4-6', ...MODEL_PRICING_TABLE['claude-sonnet-4-6'] };
  }

  // ── 5. Legacy Gemini models ───────────────────────────────────────────────
  if (normalized.includes('2.0') && normalized.includes('lite')) {
    return { key: 'gemini-2.0-flash-lite', ...MODEL_PRICING_TABLE['gemini-2.0-flash-lite'] };
  }
  if (normalized.includes('2.0') && normalized.includes('flash')) {
    return { key: 'gemini-2.0-flash', ...MODEL_PRICING_TABLE['gemini-2.0-flash'] };
  }
  if (normalized.includes('1.5') && normalized.includes('pro')) {
    return { key: 'gemini-1.5-pro', ...MODEL_PRICING_TABLE['gemini-1.5-pro'] };
  }
  if (normalized.includes('1.5') && normalized.includes('flash')) {
    return { key: 'gemini-1.5-flash', ...MODEL_PRICING_TABLE['gemini-1.5-flash'] };
  }

  // ── 6. Legacy OpenAI models ───────────────────────────────────────────────
  if (normalized.includes('gpt-4o') && normalized.includes('mini')) {
    return { key: 'gpt-4o-mini', ...MODEL_PRICING_TABLE['gpt-4o-mini'] };
  }
  if (normalized.includes('gpt-4o') || normalized.includes('gpt-4')) {
    return { key: 'gpt-4o', ...MODEL_PRICING_TABLE['gpt-4o'] };
  }

  // ── 7. Ultimate fallback ──────────────────────────────────────────────────
  const fallback = MODEL_PRICING_TABLE[DEFAULT_MODEL_KEY];
  return { key: DEFAULT_MODEL_KEY, ...fallback };
}

/**
 * Storage keys for Memento / Extension Context state
 */
export const STORAGE_KEYS = {
  SESSION_HISTORY: 'antigravity_token_counter_history',
  DAILY_STATS: 'antigravity_token_counter_daily',
  ALL_TIME_INPUT_TOKENS: 'antigravity_all_time_input_tokens',
  ALL_TIME_OUTPUT_TOKENS: 'antigravity_all_time_output_tokens',
} as const;

/**
 * Default Antigravity brain path
 */
export function getDefaultBrainDirectory(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain');
}
