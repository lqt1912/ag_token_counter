import * as vscode from 'vscode';
import { AggregatedStats, PricingRates } from '../types';
import { COMMANDS, CONFIG_KEYS, STATUS_BAR_FORMATS } from '../constants';

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100 // High priority on status bar
    );
    this.statusBarItem.command = COMMANDS.SHOW_STATS;
    this.statusBarItem.text = '$(hubot) Tokens: --';
    this.statusBarItem.tooltip = 'Antigravity Token Counter - Initializing...';
    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);
  }

  /**
   * Updates status bar text and rich markdown tooltip based on latest statistics
   */
  public update(stats: AggregatedStats, pricing: PricingRates): void {
    const config = vscode.workspace.getConfiguration();
    const format = config.get<string>(CONFIG_KEYS.STATUS_BAR_FORMAT, STATUS_BAR_FORMATS.COMPACT);

    const session = stats.currentSession;
    const inTokens = session ? session.metrics.inputTokens : 0;
    const outTokens = session ? session.metrics.outputTokens : 0;
    const totalTokens = session ? session.metrics.totalTokens : 0;
    const cost = session ? session.metrics.estimatedCostUsd : 0;

    // Format text
    switch (format) {
      case STATUS_BAR_FORMATS.DETAILED:
        this.statusBarItem.text = `$(hubot) 📥 ${inTokens.toLocaleString()} | 📤 ${outTokens.toLocaleString()} ($${cost.toFixed(3)})`;
        break;
      case STATUS_BAR_FORMATS.TOTAL_ONLY:
        this.statusBarItem.text = `$(dashboard) ${this.formatCompactNumber(totalTokens)} tokens`;
        break;
      case STATUS_BAR_FORMATS.WITH_COST:
        this.statusBarItem.text = `$(sparkle) ${this.formatCompactNumber(totalTokens)} ($${cost.toFixed(3)})`;
        break;
      case STATUS_BAR_FORMATS.COMPACT:
      default:
        this.statusBarItem.text = `$(hubot) In: ${this.formatCompactNumber(inTokens)} | Out: ${this.formatCompactNumber(outTokens)}`;
        break;
    }

    // Build rich Markdown tooltip
    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;

    tooltip.appendMarkdown(`### 🤖 Antigravity Token Counter\n\n`);

    if (session) {
      tooltip.appendMarkdown(`**Active Session**: \`${session.title}\`\n\n`);
      if (session.detectedModelName) {
        tooltip.appendMarkdown(`🤖 **Current Model**: \`${session.detectedModelName}\`\n\n`);
      }
      tooltip.appendMarkdown(`| Metric | Count |\n`);
      tooltip.appendMarkdown(`| :--- | :--- |\n`);
      tooltip.appendMarkdown(`| 📥 **Input Tokens** | **${session.metrics.inputTokens.toLocaleString()}** |\n`);
      tooltip.appendMarkdown(`| 📤 **Output Tokens** | **${session.metrics.outputTokens.toLocaleString()}** |\n`);
      tooltip.appendMarkdown(`| 🔢 **Total Tokens** | **${session.metrics.totalTokens.toLocaleString()}** |\n`);
      tooltip.appendMarkdown(`| 💵 **Est. Cost** | **$${session.metrics.estimatedCostUsd.toFixed(4)}** |\n`);
      tooltip.appendMarkdown(`| 💬 User Msgs / AI Steps | ${session.userMessageCount} / ${session.stepCount} |\n`);
      tooltip.appendMarkdown(`| 🛠️ Tool Executions | ${session.toolCallCount} |\n\n`);

      if (session.modelBreakdown && Object.keys(session.modelBreakdown).length > 1) {
        tooltip.appendMarkdown(`**Models in Current Session**:\n`);
        for (const m of Object.values(session.modelBreakdown)) {
          tooltip.appendMarkdown(`- \`${m.modelName}\`: **${m.totalTokens.toLocaleString()}** tokens ($${m.estimatedCostUsd.toFixed(4)})\n`);
        }
        tooltip.appendMarkdown(`\n`);
      }
    } else {
      tooltip.appendMarkdown(`*No active conversation detected yet.*\n\n`);
    }

    tooltip.appendMarkdown(`---\n`);
    tooltip.appendMarkdown(`**📅 Today**: ${stats.today.totalTokens.toLocaleString()} tokens ($${stats.today.estimatedCostUsd.toFixed(4)})\n\n`);
    tooltip.appendMarkdown(`**🌐 All-Time (${stats.totalConversationsTracked} chats)**: ${stats.allTime.totalTokens.toLocaleString()} tokens ($${stats.allTime.estimatedCostUsd.toFixed(4)})\n\n`);

    if (stats.byModel && Object.keys(stats.byModel).length > 0) {
      tooltip.appendMarkdown(`---\n`);
      tooltip.appendMarkdown(`**📊 All-Time Usage by Model**:\n\n`);
      tooltip.appendMarkdown(`| Model | Tokens | Cost | Share |\n`);
      tooltip.appendMarkdown(`| :--- | :--- | :--- | :--- |\n`);

      const sortedModels = Object.values(stats.byModel).sort((a, b) => b.totalTokens - a.totalTokens);
      const totalAllTokens = stats.allTime.totalTokens || 1;

      for (const m of sortedModels) {
        const pct = Math.round((m.totalTokens / totalAllTokens) * 100);
        tooltip.appendMarkdown(`| ${m.modelName} | ${this.formatCompactNumber(m.totalTokens)} | $${m.estimatedCostUsd.toFixed(3)} | ${pct}% |\n`);
      }
      tooltip.appendMarkdown(`\n`);
    }

    const profileDisplay = pricing.isAutoDetected
      ? `⚡ Auto-Detected (${pricing.modelName})`
      : `${pricing.modelName}`;
    tooltip.appendMarkdown(`*Pricing Profile: ${profileDisplay} ($${pricing.inputPerMillion}/1M In, $${pricing.outputPerMillion}/1M Out)*\n\n`);
    tooltip.appendMarkdown(`👉 *Click to open Token Counter Menu*`);

    this.statusBarItem.tooltip = tooltip;

  }

  /**
   * Helper to format numbers compactly (e.g. 1,234 -> 1.2k, 1,200,000 -> 1.2M)
   */
  private formatCompactNumber(num: number): string {
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (num >= 1_000) {
      return (num / 1_000).toFixed(1) + 'k';
    }
    return num.toString();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
