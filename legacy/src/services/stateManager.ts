import * as vscode from 'vscode';
import { ConversationSession, TokenMetrics, AggregatedStats, PricingRates } from '../types';
import { CONFIG_KEYS, MODEL_PRICING_TABLE, resolveModelPricing, DEFAULT_MODEL_KEY } from '../constants';

export class StateManager implements vscode.Disposable {
  private context: vscode.ExtensionContext;
  private currentSession: ConversationSession | null = null;
  private sessionResetOffsets: Map<string, TokenMetrics> = new Map();
  private allSessions: Map<string, ConversationSession> = new Map();

  private _onDidChangeStats = new vscode.EventEmitter<AggregatedStats>();
  public readonly onDidChangeStats = this._onDidChangeStats.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    const savedOffsets = this.context.workspaceState.get<Record<string, TokenMetrics>>('sessionResetOffsets');
    if (savedOffsets) {
      this.sessionResetOffsets = new Map(Object.entries(savedOffsets));
    }
  }

  /**
   * Returns active pricing rates based on VS Code configuration and optional session context
   */
  public getPricingRates(session?: ConversationSession | null): PricingRates {
    const config = vscode.workspace.getConfiguration();
    const modelProfile = config.get<string>(CONFIG_KEYS.MODEL_PRICING, 'auto');

    if (modelProfile === 'custom') {
      const customIn = config.get<number>(CONFIG_KEYS.CUSTOM_INPUT_COST, MODEL_PRICING_TABLE['custom'].inputPerMillion);
      const customOut = config.get<number>(CONFIG_KEYS.CUSTOM_OUTPUT_COST, MODEL_PRICING_TABLE['custom'].outputPerMillion);
      return {
        modelName: 'Custom Pricing',
        modelKey: 'custom',
        inputPerMillion: customIn,
        outputPerMillion: customOut,
        isAutoDetected: false,
      };
    }

    if (modelProfile === 'auto') {
      const activeSession = session || this.currentSession;
      const detectedKey = activeSession?.detectedModel;
      const resolved = resolveModelPricing(detectedKey);

      return {
        modelName: resolved.name,
        modelKey: resolved.key,
        inputPerMillion: resolved.inputPerMillion,
        outputPerMillion: resolved.outputPerMillion,
        isAutoDetected: true,
      };
    }

    const matched = MODEL_PRICING_TABLE[modelProfile] || MODEL_PRICING_TABLE[DEFAULT_MODEL_KEY];
    return {
      modelName: matched.name,
      modelKey: modelProfile,
      inputPerMillion: matched.inputPerMillion,
      outputPerMillion: matched.outputPerMillion,
      isAutoDetected: false,
    };
  }

  /**
   * Updates current active session data and recalculates aggregates
   */
  public updateCurrentSession(session: ConversationSession): void {
    this.currentSession = session;
    this.allSessions.set(session.conversationId, session);
    this.recalculateAndEmit();
  }

  /**
   * Updates historical sessions list
   */
  public setHistoricalSessions(sessions: ConversationSession[]): void {
    for (const s of sessions) {
      this.allSessions.set(s.conversationId, s);
    }
    if (!this.currentSession && sessions.length > 0) {
      this.currentSession = sessions[0];
    }
    this.recalculateAndEmit();
  }

  /**
   * Resets counter for the current active conversation
   */
  public resetCurrentSession(): void {
    if (this.currentSession) {
      this.sessionResetOffsets.set(this.currentSession.conversationId, {
        ...this.currentSession.metrics,
      });
      const obj = Object.fromEntries(this.sessionResetOffsets.entries());
      this.context.workspaceState.update('sessionResetOffsets', obj);
      this.recalculateAndEmit();
    }
  }

  /**
   * Gets effective metrics for current session (accounting for session reset offsets)
   */
  public getEffectiveCurrentSession(): ConversationSession | null {
    if (!this.currentSession) return null;

    const offset = this.sessionResetOffsets.get(this.currentSession.conversationId);
    if (!offset) {
      return this.currentSession;
    }

    const effectiveInput = Math.max(0, this.currentSession.metrics.inputTokens - offset.inputTokens);
    const effectiveOutput = Math.max(0, this.currentSession.metrics.outputTokens - offset.outputTokens);
    const effectiveTotal = effectiveInput + effectiveOutput;

    const pricing = this.getPricingRates(this.currentSession);
    const effectiveCost =
      Math.round(((effectiveInput / 1_000_000) * pricing.inputPerMillion + (effectiveOutput / 1_000_000) * pricing.outputPerMillion) * 10000) / 10000;

    return {
      ...this.currentSession,
      metrics: {
        inputTokens: effectiveInput,
        outputTokens: effectiveOutput,
        totalTokens: effectiveTotal,
        estimatedCostUsd: effectiveCost,
      },
    };
  }

  /**
   * Calculates Today and All-Time aggregated metrics along with per-model breakdown
   */
  public getAggregatedStats(): AggregatedStats {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    let todayIn = 0;
    let todayOut = 0;
    let todayCost = 0;

    let allTimeIn = 0;
    let allTimeOut = 0;
    let allTimeCost = 0;

    const byModel: Record<string, import('../types').ModelUsageMetrics> = {};
    const todayByModel: Record<string, import('../types').ModelUsageMetrics> = {};

    const accumulateModel = (
      targetMap: Record<string, import('../types').ModelUsageMetrics>,
      key: string,
      name: string,
      inT: number,
      outT: number,
      cost: number
    ) => {
      if (!targetMap[key]) {
        targetMap[key] = {
          modelKey: key,
          modelName: name,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          sessionCount: 0,
        };
      }
      targetMap[key].inputTokens += inT;
      targetMap[key].outputTokens += outT;
      targetMap[key].totalTokens += inT + outT;
      targetMap[key].estimatedCostUsd += cost;
      targetMap[key].sessionCount = (targetMap[key].sessionCount || 0) + 1;
    };

    for (const session of this.allSessions.values()) {
      const isToday = session.lastUpdated >= todayTimestamp;

      allTimeIn += session.metrics.inputTokens;
      allTimeOut += session.metrics.outputTokens;
      allTimeCost += session.metrics.estimatedCostUsd;

      if (isToday) {
        todayIn += session.metrics.inputTokens;
        todayOut += session.metrics.outputTokens;
        todayCost += session.metrics.estimatedCostUsd;
      }

      // Aggregate per-model metrics from session breakdown
      if (session.modelBreakdown && Object.keys(session.modelBreakdown).length > 0) {
        for (const [mKey, mMetrics] of Object.entries(session.modelBreakdown)) {
          accumulateModel(
            byModel,
            mKey,
            mMetrics.modelName,
            mMetrics.inputTokens,
            mMetrics.outputTokens,
            mMetrics.estimatedCostUsd
          );
          if (isToday) {
            accumulateModel(
              todayByModel,
              mKey,
              mMetrics.modelName,
              mMetrics.inputTokens,
              mMetrics.outputTokens,
              mMetrics.estimatedCostUsd
            );
          }
        }
      } else {
        // Fallback for sessions without detailed breakdown
        const mKey = session.detectedModel || DEFAULT_MODEL_KEY;
        const resolved = resolveModelPricing(mKey);
        accumulateModel(
          byModel,
          resolved.key,
          resolved.name,
          session.metrics.inputTokens,
          session.metrics.outputTokens,
          session.metrics.estimatedCostUsd
        );
        if (isToday) {
          accumulateModel(
            todayByModel,
            resolved.key,
            resolved.name,
            session.metrics.inputTokens,
            session.metrics.outputTokens,
            session.metrics.estimatedCostUsd
          );
        }
      }
    }

    // Round costs in model breakdown maps
    for (const m of Object.values(byModel)) {
      m.estimatedCostUsd = Math.round(m.estimatedCostUsd * 10000) / 10000;
    }
    for (const m of Object.values(todayByModel)) {
      m.estimatedCostUsd = Math.round(m.estimatedCostUsd * 10000) / 10000;
    }

    const roundedTodayCost = Math.round(todayCost * 10000) / 10000;
    const roundedAllTimeCost = Math.round(allTimeCost * 10000) / 10000;

    return {
      currentSession: this.getEffectiveCurrentSession(),
      today: {
        inputTokens: todayIn,
        outputTokens: todayOut,
        totalTokens: todayIn + todayOut,
        estimatedCostUsd: roundedTodayCost,
      },
      allTime: {
        inputTokens: allTimeIn,
        outputTokens: allTimeOut,
        totalTokens: allTimeIn + allTimeOut,
        estimatedCostUsd: roundedAllTimeCost,
      },
      todayByModel,
      byModel,
      totalConversationsTracked: this.allSessions.size,
    };
  }


  public getAllSessions(): ConversationSession[] {
    return Array.from(this.allSessions.values()).sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  private recalculateAndEmit(): void {
    const stats = this.getAggregatedStats();
    this._onDidChangeStats.fire(stats);
  }

  public dispose(): void {
    this._onDidChangeStats.dispose();
  }
}
