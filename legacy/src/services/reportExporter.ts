import { AggregatedStats, ConversationSession, PricingRates } from '../types';

export class ReportExporter {
  /**
   * Generates a comprehensive Markdown report of token usage
   */
  public static generateMarkdownReport(stats: AggregatedStats, sessions: ConversationSession[], pricing: PricingRates): string {
    const dateStr = new Date().toLocaleString();

    let md = `# Antigravity Token Usage Report\n\n`;
    md += `*Generated on: ${dateStr}*\n`;
    md += `*Pricing Profile: **${pricing.modelName}** ($${pricing.inputPerMillion}/1M In, $${pricing.outputPerMillion}/1M Out)*\n\n`;

    md += `## 📊 Summary Overview\n\n`;
    md += `| Scope | Input Tokens | Output Tokens | Total Tokens | Estimated Cost |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;

    if (stats.currentSession) {
      const cur = stats.currentSession.metrics;
      md += `| **Active Session** | ${cur.inputTokens.toLocaleString()} | ${cur.outputTokens.toLocaleString()} | **${cur.totalTokens.toLocaleString()}** | **$${cur.estimatedCostUsd.toFixed(4)}** |\n`;
    }

    md += `| **Today** | ${stats.today.inputTokens.toLocaleString()} | ${stats.today.outputTokens.toLocaleString()} | **${stats.today.totalTokens.toLocaleString()}** | **$${stats.today.estimatedCostUsd.toFixed(4)}** |\n`;
    md += `| **All-Time (${stats.totalConversationsTracked} sessions)** | ${stats.allTime.inputTokens.toLocaleString()} | ${stats.allTime.outputTokens.toLocaleString()} | **${stats.allTime.totalTokens.toLocaleString()}** | **$${stats.allTime.estimatedCostUsd.toFixed(4)}** |\n\n`;

    // Model breakdown section
    if (stats.byModel && Object.keys(stats.byModel).length > 0) {
      md += `## 🤖 Breakdown by AI Model\n\n`;
      md += `### All-Time Usage by Model\n\n`;
      md += `| AI Model | Input Tokens | Output Tokens | Total Tokens | Share (%) | Est. Cost (USD) | Sessions |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

      const totalTokens = stats.allTime.totalTokens || 1;
      const sortedAllTime = Object.values(stats.byModel).sort((a, b) => b.totalTokens - a.totalTokens);
      for (const m of sortedAllTime) {
        const pct = Math.round((m.totalTokens / totalTokens) * 100);
        md += `| **${m.modelName}** | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | **${m.totalTokens.toLocaleString()}** | ${pct}% | **$${m.estimatedCostUsd.toFixed(4)}** | ${m.sessionCount || 1} |\n`;
      }
      md += `\n`;

      if (stats.todayByModel && Object.keys(stats.todayByModel).length > 0) {
        md += `### Today's Usage by Model\n\n`;
        md += `| AI Model | Input Tokens | Output Tokens | Total Tokens | Est. Cost (USD) | Sessions |\n`;
        md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
        const sortedToday = Object.values(stats.todayByModel).sort((a, b) => b.totalTokens - a.totalTokens);
        for (const m of sortedToday) {
          md += `| **${m.modelName}** | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | **${m.totalTokens.toLocaleString()}** | **$${m.estimatedCostUsd.toFixed(4)}** | ${m.sessionCount || 1} |\n`;
        }
        md += `\n`;
      }
    }

    md += `## 💬 Detailed Conversation History\n\n`;
    md += `| Conversation ID | Title | Model | User Msgs | AI Responses | In Tokens | Out Tokens | Total | Est. Cost | Last Updated |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    for (const session of sessions) {
      const timeStr = new Date(session.lastUpdated).toLocaleString();
      const m = session.metrics;
      const titleSafe = session.title.replace(/\|/g, '\\|');
      const modelLabel = session.detectedModelName || 'Default';
      md += `| \`${session.conversationId.slice(0, 8)}\` | ${titleSafe} | ${modelLabel} | ${session.userMessageCount} | ${session.modelResponseCount} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | **${m.totalTokens.toLocaleString()}** | $${m.estimatedCostUsd.toFixed(4)} | ${timeStr} |\n`;
    }

    md += `\n---\n*Report created by [Antigravity Token Counter](https://github.com/google/antigravity)*\n`;
    return md;
  }

  /**
   * Generates a CSV format report
   */
  public static generateCsvReport(sessions: ConversationSession[], pricing: PricingRates): string {
    let csv = `# Pricing Profile: ${pricing.modelName} (In: $${pricing.inputPerMillion}/1M Out: $${pricing.outputPerMillion}/1M)\n`;
    csv += `Conversation ID,Title,Model,User Messages,AI Responses,Tool Calls,Input Tokens,Output Tokens,Total Tokens,Cost (USD),Last Updated\n`;

    for (const session of sessions) {
      const titleSafe = `"${session.title.replace(/"/g, '""')}"`;
      const modelSafe = `"${(session.detectedModelName || 'Default').replace(/"/g, '""')}"`;
      const timeStr = new Date(session.lastUpdated).toISOString();
      const m = session.metrics;
      csv += `${session.conversationId},${titleSafe},${modelSafe},${session.userMessageCount},${session.modelResponseCount},${session.toolCallCount},${m.inputTokens},${m.outputTokens},${m.totalTokens},${m.estimatedCostUsd.toFixed(4)},${timeStr}\n`;
    }

    return csv;
  }
}

