import * as fs from 'fs';
import * as path from 'path';
import { TranscriptParser } from '../services/transcriptParser';
import { DataStoreService } from '../services/store';
import { getDefaultBrainDirectory, MODEL_PRICING_TABLE, DEFAULT_MODEL_KEY, TOTAL_SUPPORTED_MODELS_COUNT, MODEL_CONTEXT_LIMITS } from '../constants';
import { PricingRates, ConversationSession, FetchAllStatsResponse } from '../types';

const defaultPricing = MODEL_PRICING_TABLE[DEFAULT_MODEL_KEY];
const pricing: PricingRates = {
  modelName: defaultPricing.name,
  modelKey: DEFAULT_MODEL_KEY,
  inputPerMillion: defaultPricing.inputPerMillion,
  outputPerMillion: defaultPricing.outputPerMillion,
  isAutoDetected: true,
};

export async function fetchAllStats(limit = 150): Promise<FetchAllStatsResponse> {
  try {
    const brainDir = getDefaultBrainDirectory();
    if (!fs.existsSync(brainDir)) {
      return { error: `Brain directory not found at: ${brainDir}` };
    }

    const store = DataStoreService.getInstance();
    const parser = new TranscriptParser();
    const entries = fs.readdirSync(brainDir, { withFileTypes: true });
    
    // Sort and limit to avoid processing hundreds of old conversations synchronously
    const conversationDirs = entries
      .filter((entry) => entry.isDirectory() && /^[a-f0-9\-]{36}$/i.test(entry.name))
      .map((entry) => {
        const fullPath = path.join(brainDir, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          return { id: entry.name, lastUpdated: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b!.lastUpdated - a!.lastUpdated)
      .slice(0, limit);

    const validSessions: ConversationSession[] = [];
    const toParse: { id: string; transcriptPath: string }[] = [];

    // Fast O(1) in-memory check for each conversation directory
    for (const dir of conversationDirs) {
      if (!dir) continue;
      const transcriptPath = path.join(brainDir, dir.id, '.system_generated', 'logs', 'transcript.jsonl');
      if (!fs.existsSync(transcriptPath)) continue;

      try {
        const tStat = fs.statSync(transcriptPath);
        const cached = store.getSession(dir.id);
        // If cached session exists and mtime matches, return instantly from persistent JSON store
        if (cached && cached.lastUpdated === tStat.mtimeMs) {
          validSessions.push(cached);
        } else {
          toParse.push({ id: dir.id, transcriptPath });
        }
      } catch {
        continue;
      }
    }

    // Only parse files that are actually new or modified (typically 0 or 1 file!)
    if (toParse.length > 0) {
      for (const item of toParse) {
        const parsed = await parser.parseFile(item.transcriptPath, item.id, pricing);
        if (parsed) {
          store.setSession(parsed);
          validSessions.push(parsed);
        }
      }
      store.save();
    }

    // Sort validSessions by lastUpdated descending
    validSessions.sort((a, b) => b.lastUpdated - a.lastUpdated);

    return {
      sessions: validSessions,
      currentSession: validSessions[0] || null,
      totalSupportedModels: TOTAL_SUPPORTED_MODELS_COUNT,
      contextLimits: MODEL_CONTEXT_LIMITS,
    };
  } catch (err: any) {
    console.error('Service error fetching stats:', err);
    return { error: err.message || 'Unknown error' };
  }
}
