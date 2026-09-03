import * as path from 'path';
import * as os from 'os';

export const DEFAULT_MODEL_KEY = 'gemini-3.7-flash';

// ─────────────────────────────────────────────────────────────────────────────
// Antigravity available models
// ─────────────────────────────────────────────────────────────────────────────
export const MODEL_PRICING_TABLE: Record<string, { name: string; inputPerMillion: number; outputPerMillion: number }> = {
  'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', inputPerMillion: 0.75, outputPerMillion: 3.75 },
  'gemini-3.8-flash-cyber': { name: 'Gemini 3.8 Flash Cyber', inputPerMillion: 0.75, outputPerMillion: 3.75 },
  'gemini-3.7-flash': { name: 'Gemini 3.7 Flash', inputPerMillion: 0.75, outputPerMillion: 3.75 },
  'gemini-3.6-flash': { name: 'Gemini 3.6 Flash', inputPerMillion: 0.75, outputPerMillion: 3.75 },
  'gemini-3.5-flash': { name: 'Gemini 3.5 Flash', inputPerMillion: 1.50, outputPerMillion: 9.00 },
  'gemini-3.1-pro': { name: 'Gemini 3.1 Pro', inputPerMillion: 2.00, outputPerMillion: 12.00 },
  'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-opus-4-6': { name: 'Claude Opus 4.6', inputPerMillion: 5.00, outputPerMillion: 25.00 },
  'claude-3-7-sonnet': { name: 'Claude 3.7 Sonnet', inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-3-5-sonnet': { name: 'Claude 3.5 Sonnet', inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'gpt-oss-120b': { name: 'GPT-OSS 120B', inputPerMillion: 0.90, outputPerMillion: 0.90 },
  'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-2.0-flash-lite': { name: 'Gemini 2.0 Flash Lite', inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-1.5-flash': { name: 'Gemini 1.5 Flash', inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-1.5-pro': { name: 'Gemini 1.5 Pro', inputPerMillion: 1.25, outputPerMillion: 5.00 },
  'claude-3-5-haiku': { name: 'Claude 3.5 Haiku', inputPerMillion: 0.80, outputPerMillion: 4.00 },
  'claude-3-opus': { name: 'Claude 3 Opus', inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'gpt-4o': { name: 'GPT-4o', inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini': { name: 'GPT-4o Mini', inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'custom': { name: 'Custom Pricing', inputPerMillion: 0.75, outputPerMillion: 3.75 },
};

export const TOTAL_SUPPORTED_MODELS_COUNT = Object.keys(MODEL_PRICING_TABLE).filter((k) => k !== 'custom').length;

export function resolveModelPricing(rawNameOrKey?: string): { key: string; name: string; inputPerMillion: number; outputPerMillion: number } {
  if (!rawNameOrKey) {
    const fallback = MODEL_PRICING_TABLE[DEFAULT_MODEL_KEY];
    return { key: DEFAULT_MODEL_KEY, ...fallback };
  }

  const normalized = rawNameOrKey.toLowerCase().trim();

  if (MODEL_PRICING_TABLE[normalized]) return { key: normalized, ...MODEL_PRICING_TABLE[normalized] };

  // 1. Specific Claude Sonnet & Opus versions
  if (normalized.includes('claude') && (normalized.includes('4.6') || normalized.includes('4-6')) && normalized.includes('opus')) {
    return { key: 'claude-opus-4-6', ...MODEL_PRICING_TABLE['claude-opus-4-6'] };
  }
  if (normalized.includes('claude') && (normalized.includes('4.6') || normalized.includes('4-6')) && normalized.includes('sonnet')) {
    return { key: 'claude-sonnet-4-6', ...MODEL_PRICING_TABLE['claude-sonnet-4-6'] };
  }
  if (normalized.includes('claude') && (normalized.includes('3.7') || normalized.includes('3-7')) && normalized.includes('sonnet')) {
    return { key: 'claude-3-7-sonnet', ...MODEL_PRICING_TABLE['claude-3-7-sonnet'] };
  }
  if (normalized.includes('claude') && (normalized.includes('3.5') || normalized.includes('3-5')) && normalized.includes('sonnet')) {
    return { key: 'claude-3-5-sonnet', ...MODEL_PRICING_TABLE['claude-3-5-sonnet'] };
  }

  // 2. Gemini versions
  if (normalized.includes('gemini') && normalized.includes('3.8') && (normalized.includes('cyber') || normalized.includes('flash cyber'))) {
    return { key: 'gemini-3.8-flash-cyber', ...MODEL_PRICING_TABLE['gemini-3.8-flash-cyber'] };
  }
  if (normalized.includes('gemini') && normalized.includes('3.8')) {
    return { key: 'gemini-3.8-flash', ...MODEL_PRICING_TABLE['gemini-3.8-flash'] };
  }
  if (normalized.includes('gemini') && normalized.includes('3.7')) {
    return { key: 'gemini-3.7-flash', ...MODEL_PRICING_TABLE['gemini-3.7-flash'] };
  }
  if (normalized.includes('gemini') && normalized.includes('3.6')) {
    return { key: 'gemini-3.6-flash', ...MODEL_PRICING_TABLE['gemini-3.6-flash'] };
  }
  if (normalized.includes('gemini') && normalized.includes('3.5')) {
    return { key: 'gemini-3.5-flash', ...MODEL_PRICING_TABLE['gemini-3.5-flash'] };
  }
  if (normalized.includes('gemini') && normalized.includes('3.1')) {
    return { key: 'gemini-3.1-pro', ...MODEL_PRICING_TABLE['gemini-3.1-pro'] };
  }
  if (normalized.includes('gpt-oss') || normalized.includes('gpt oss') || normalized.includes('120b')) {
    return { key: 'gpt-oss-120b', ...MODEL_PRICING_TABLE['gpt-oss-120b'] };
  }
  
  if (normalized.includes('gemini') && normalized.includes('flash')) return { key: 'gemini-3.7-flash', ...MODEL_PRICING_TABLE['gemini-3.7-flash'] };
  if (normalized.includes('gemini') && normalized.includes('pro')) return { key: 'gemini-3.1-pro', ...MODEL_PRICING_TABLE['gemini-3.1-pro'] };

  // 3. Generic Fallbacks for Claude
  if (normalized.includes('claude') && normalized.includes('opus')) return { key: 'claude-opus-4-6', ...MODEL_PRICING_TABLE['claude-opus-4-6'] };
  if (normalized.includes('claude') && normalized.includes('sonnet')) return { key: 'claude-sonnet-4-6', ...MODEL_PRICING_TABLE['claude-sonnet-4-6'] };
  if (normalized.includes('haiku')) return { key: 'claude-3-5-haiku', ...MODEL_PRICING_TABLE['claude-3-5-haiku'] };
  if (normalized.includes('claude')) return { key: 'claude-sonnet-4-6', ...MODEL_PRICING_TABLE['claude-sonnet-4-6'] };

  // 4. Legacy Gemini
  if (normalized.includes('2.0') && normalized.includes('lite')) return { key: 'gemini-2.0-flash-lite', ...MODEL_PRICING_TABLE['gemini-2.0-flash-lite'] };
  if (normalized.includes('2.0') && normalized.includes('flash')) return { key: 'gemini-2.0-flash', ...MODEL_PRICING_TABLE['gemini-2.0-flash'] };
  if (normalized.includes('1.5') && normalized.includes('pro')) return { key: 'gemini-1.5-pro', ...MODEL_PRICING_TABLE['gemini-1.5-pro'] };
  if (normalized.includes('1.5') && normalized.includes('flash')) return { key: 'gemini-1.5-flash', ...MODEL_PRICING_TABLE['gemini-1.5-flash'] };
  
  // 5. OpenAI
  if (normalized.includes('gpt-4o') && normalized.includes('mini')) return { key: 'gpt-4o-mini', ...MODEL_PRICING_TABLE['gpt-4o-mini'] };
  if (normalized.includes('gpt-4o') || normalized.includes('gpt-4')) return { key: 'gpt-4o', ...MODEL_PRICING_TABLE['gpt-4o'] };

  const fallback = MODEL_PRICING_TABLE[DEFAULT_MODEL_KEY];
  return { key: DEFAULT_MODEL_KEY, ...fallback };
}

export function getDefaultBrainDirectory(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain');
}

export const DATA_STORE_DIR_NAME = 'AI-Token-Analytics';
export const DATA_STORE_FILE_NAME = 'data-store.json';

export function getDataStorePath(): string {
  const baseDir = process.env.APPDATA || path.join(os.homedir(), '.gemini', 'antigravity-ide');
  return path.join(baseDir, DATA_STORE_DIR_NAME, DATA_STORE_FILE_NAME);
}

// ─────────────────────────────────────────────────────────────────────────────
// Model context window limits
// ─────────────────────────────────────────────────────────────────────────────
export const MODEL_CONTEXT_LIMITS: Record<string, { limit: number; label: string }> = {
  'gemini-3.8-flash': { limit: 1_000_000, label: '1M Context' },
  'gemini-3.8-flash-cyber': { limit: 1_000_000, label: '1M Context' },
  'gemini-3.7-flash': { limit: 1_000_000, label: '1M Context' },
  'gemini-3.6-flash': { limit: 1_000_000, label: '1M Context' },
  'gemini-3.5-flash': { limit: 1_000_000, label: '1M Context' },
  'gemini-3.1-pro': { limit: 1_000_000, label: '1M Context' },
  'claude-sonnet-4-6': { limit: 200_000, label: '200K Context' },
  'claude-opus-4-6': { limit: 200_000, label: '200K Context' },
  'claude-3-7-sonnet': { limit: 200_000, label: '200K Context' },
  'claude-3-5-sonnet': { limit: 200_000, label: '200K Context' },
  'claude-3-5-haiku': { limit: 200_000, label: '200K Context' },
  'claude-3-opus': { limit: 200_000, label: '200K Context' },
  'gpt-oss-120b': { limit: 128_000, label: '128K Context' },
  'gpt-4o': { limit: 128_000, label: '128K Context' },
  'gpt-4o-mini': { limit: 128_000, label: '128K Context' },
  'default': { limit: 200_000, label: '200K Context' },
};

export function getModelContextLimit(modelKey?: string): { limit: number; label: string } {
  if (modelKey && MODEL_CONTEXT_LIMITS[modelKey]) {
    return MODEL_CONTEXT_LIMITS[modelKey];
  }
  return MODEL_CONTEXT_LIMITS['default'];
}


