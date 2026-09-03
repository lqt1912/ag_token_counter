export interface RawTranscriptStep {
  step_index?: number;
  source?: 'USER_EXPLICIT' | 'MODEL' | 'SYSTEM' | string;
  type?: 'USER_INPUT' | 'PLANNER_RESPONSE' | 'SYSTEM_MESSAGE' | string;
  status?: string;
  content?: string;
  tool_calls?: Array<{
    name?: string;
    description?: string;
    args?: Record<string, unknown>;
  }>;
  is_truncated?: boolean;
}

export interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ModelUsageMetrics {
  modelKey: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionCount?: number;
  stepCount?: number;
}

export interface ConversationSession {
  conversationId: string;
  title: string;
  lastUpdated: number;
  transcriptPath: string;
  stepCount: number;
  userMessageCount: number;
  modelResponseCount: number;
  toolCallCount: number;
  detectedModel?: string;
  detectedModelName?: string;
  modelBreakdown?: Record<string, ModelUsageMetrics>;
  metrics: TokenMetrics;
}

export interface AggregatedStats {
  currentSession: ConversationSession | null;
  today: TokenMetrics;
  allTime: TokenMetrics;
  todayByModel?: Record<string, ModelUsageMetrics>;
  byModel?: Record<string, ModelUsageMetrics>;
  totalConversationsTracked: number;
}

export interface PricingRates {
  modelName: string;
  modelKey?: string;
  inputPerMillion: number;
  outputPerMillion: number;
  isAutoDetected?: boolean;
}

export interface FetchAllStatsResponse {
  sessions?: ConversationSession[];
  currentSession?: ConversationSession | null;
  totalSupportedModels?: number;
  contextLimits?: Record<string, { limit: number; label: string }>;
  error?: string;
}

