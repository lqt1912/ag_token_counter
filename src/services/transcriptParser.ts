import * as fs from 'fs';
import * as readline from 'readline';
import { RawTranscriptStep, TokenMetrics, ConversationSession, PricingRates, ModelUsageMetrics } from '../types';
import { TokenizerService } from './tokenizer';
import { resolveModelPricing, DEFAULT_MODEL_KEY } from '../constants';

// In-memory cache to prevent re-parsing unchanged transcript files
const fileCache = new Map<string, { mtime: number; session: ConversationSession }>();

export class TranscriptParser {
  private tokenizer: TokenizerService;

  constructor() {
    this.tokenizer = TokenizerService.getInstance();
  }

  public async parseFile(
    filePath: string,
    conversationId: string,
    pricing: PricingRates
  ): Promise<ConversationSession | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const stats = fs.statSync(filePath);
      
      // Fast Cache Check: If file mtime has not changed, return cached session instantly
      const cached = fileCache.get(filePath);
      if (cached && cached.mtime === stats.mtimeMs) {
        return cached.session;
      }

      const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let inputTokens = 0;
      let outputTokens = 0;
      let stepCount = 0;
      let userMessageCount = 0;
      let modelResponseCount = 0;
      let toolCallCount = 0;
      let lastDetectedModelKey: string | undefined;
      let lastDetectedModelName: string | undefined;
      let title = `Conversation ${conversationId.slice(0, 8)}`;

      const defaultResolved = resolveModelPricing(pricing.modelKey || DEFAULT_MODEL_KEY);
      let currentModelKey = defaultResolved.key;
      let currentModelName = defaultResolved.name;
      let hasExplicitModel = false;

      const modelBreakdown: Record<string, ModelUsageMetrics> = {};
      const initialStepsBuffer: { inT: number; outT: number; isNewStep: boolean }[] = [];

      const addModelTokens = (mKey: string, mName: string, inT: number, outT: number, isNewStep: boolean) => {
        if (!modelBreakdown[mKey]) {
          modelBreakdown[mKey] = {
            modelKey: mKey,
            modelName: mName,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            stepCount: 0,
          };
        }
        modelBreakdown[mKey].inputTokens += inT;
        modelBreakdown[mKey].outputTokens += outT;
        modelBreakdown[mKey].totalTokens += inT + outT;
        if (isNewStep) {
          modelBreakdown[mKey].stepCount = (modelBreakdown[mKey].stepCount || 0) + 1;
        }
      };

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const step: RawTranscriptStep = JSON.parse(line);
          stepCount++;

          const rawModel = this.extractModelFromStep(step);
          if (rawModel) {
            const resolved = resolveModelPricing(rawModel);
            currentModelKey = resolved.key;
            currentModelName = resolved.name;
            lastDetectedModelKey = resolved.key;
            lastDetectedModelName = resolved.name;

            if (!hasExplicitModel) {
              hasExplicitModel = true;
              for (const item of initialStepsBuffer) {
                addModelTokens(currentModelKey, currentModelName, item.inT, item.outT, item.isNewStep);
              }
              initialStepsBuffer.length = 0;
            }
          }

          const isUser = step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT';
          const isModel = step.type === 'PLANNER_RESPONSE' || step.source === 'MODEL';
          const isSystem = step.type === 'SYSTEM_MESSAGE' || step.source === 'SYSTEM';

          let stepInputTokens = 0;
          let stepOutputTokens = 0;

          if (step.content) {
            const tokens = this.tokenizer.countTokens(step.content);
            if (isUser || isSystem) {
              stepInputTokens += tokens;
              if (isUser) {
                userMessageCount++;
                if (userMessageCount === 1) {
                  const cleanContent = step.content.replace(/<[^>]+>/g, '').trim();
                  if (cleanContent) {
                    title = cleanContent.length > 40 ? cleanContent.slice(0, 37) + '...' : cleanContent;
                  }
                }
              }
            } else if (isModel) {
              stepOutputTokens += tokens;
              modelResponseCount++;
            } else {
              stepInputTokens += tokens;
            }
          }

          if (step.tool_calls && Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
            toolCallCount += step.tool_calls.length;
            for (const call of step.tool_calls) {
              if (call.name) {
                stepOutputTokens += this.tokenizer.countTokens(call.name);
              }
              if (call.args) {
                stepOutputTokens += this.tokenizer.countObjectTokens(call.args);
              }
            }
          }

          inputTokens += stepInputTokens;
          outputTokens += stepOutputTokens;

          if (hasExplicitModel) {
            addModelTokens(currentModelKey, currentModelName, stepInputTokens, stepOutputTokens, true);
          } else {
            initialStepsBuffer.push({ inT: stepInputTokens, outT: stepOutputTokens, isNewStep: true });
          }
        } catch (jsonErr) {
          // skip
        }
      }

      if (!hasExplicitModel && initialStepsBuffer.length > 0) {
        for (const item of initialStepsBuffer) {
          addModelTokens(currentModelKey, currentModelName, item.inT, item.outT, item.isNewStep);
        }
        initialStepsBuffer.length = 0;
      }

      let totalCalculatedCost = 0;
      for (const mKey of Object.keys(modelBreakdown)) {
        const m = modelBreakdown[mKey];
        const resolved = resolveModelPricing(mKey);
        const mPricing: PricingRates = pricing.isAutoDetected
          ? {
              modelName: resolved.name,
              modelKey: resolved.key,
              inputPerMillion: resolved.inputPerMillion,
              outputPerMillion: resolved.outputPerMillion,
              isAutoDetected: true,
            }
          : pricing;
        m.estimatedCostUsd = this.calculateCost(m.inputTokens, m.outputTokens, mPricing);
        totalCalculatedCost += m.estimatedCostUsd;
      }

      const totalTokens = inputTokens + outputTokens;
      const roundedTotalCost = Math.round(totalCalculatedCost * 10000) / 10000;

      const metrics: TokenMetrics = {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: roundedTotalCost,
      };

      const session: ConversationSession = {
        conversationId,
        title,
        lastUpdated: stats.mtimeMs,
        transcriptPath: filePath,
        stepCount,
        userMessageCount,
        modelResponseCount,
        toolCallCount,
        detectedModel: lastDetectedModelKey || currentModelKey,
        detectedModelName: lastDetectedModelName || currentModelName,
        modelBreakdown,
        metrics,
      };

      // Store in memory cache with size limit (LRU-like)
      fileCache.set(filePath, { mtime: stats.mtimeMs, session });
      if (fileCache.size > 50) {
        const firstKey = fileCache.keys().next().value;
        if (firstKey) fileCache.delete(firstKey);
      }

      return session;
    } catch (err) {
      console.error(`[TranscriptParser] Error reading ${filePath}:`, err);
      return null;
    }
  }

  private extractModelFromStep(step: RawTranscriptStep): string | null {
    const anyStep = step as Record<string, unknown>;
    if (typeof anyStep.model === 'string' && anyStep.model.trim()) return anyStep.model.trim();
    if (typeof anyStep.model_name === 'string' && anyStep.model_name.trim()) return anyStep.model_name.trim();
    if (anyStep.metadata && typeof anyStep.metadata === 'object') {
      const meta = anyStep.metadata as Record<string, unknown>;
      if (typeof meta.model === 'string' && meta.model.trim()) return meta.model.trim();
      if (typeof meta.model_name === 'string' && meta.model_name.trim()) return meta.model_name.trim();
    }

    // In Antigravity IDE, user model selection changes are recorded exclusively in user steps
    // inside <USER_SETTINGS_CHANGE>...</USER_SETTINGS_CHANGE> blocks.
    // Restricting to user steps prevents tool outputs, logs, and agent responses from falsely triggering model switches.
    const isUser = step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT';
    if (isUser && step.content) {
      const text = step.content;
      // 1. Check <USER_SETTINGS_CHANGE> block
      const blockMatch = text.match(/<USER_SETTINGS_CHANGE>([\s\S]*?)<\/USER_SETTINGS_CHANGE>/i);
      if (blockMatch) {
        const targetText = blockMatch[1];
        // Match Model Selection ... to <ModelName> (allowing dots in version numbers like 3.7, 3.8, 4.6)
        const m = targetText.match(/Model\s+Selection.*?to\s+([A-Za-z0-9\s\-\.\(\)]+?)(?:\.\s+No need|\.\s*$|\.\s*\n|\.\s*<|\r|\n|<|$)/i);
        if (m && m[1]) {
          const cleaned = m[1].replace(/[`"']/g, '').trim();
          if (cleaned && cleaned.toLowerCase() !== 'none') {
            return cleaned;
          }
        }
      }

      // 2. Structured XML tags in user steps
      const tagMatch = text.match(/<(?:model_selection|model_name|model)>([^<]+)<\//i);
      if (tagMatch && tagMatch[1]) return tagMatch[1].trim();
    }
    return null;
  }

  public calculateCost(inputTokens: number, outputTokens: number, pricing: PricingRates): number {
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    return Math.round((inputCost + outputCost) * 10000) / 10000;
  }
}
