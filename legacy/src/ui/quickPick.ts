import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';
import { LogWatcher } from '../services/logWatcher';
import { ReportExporter } from '../services/reportExporter';
import { CONFIG_KEYS, MODEL_PRICING_TABLE, STATUS_BAR_FORMATS, getDefaultBrainDirectory } from '../constants';

export class QuickPickManager {
  public static async showMenu(stateManager: StateManager, logWatcher: LogWatcher): Promise<void> {
    const stats = stateManager.getAggregatedStats();
    const pricing = stateManager.getPricingRates();
    const current = stats.currentSession;

    const curIn = current ? current.metrics.inputTokens.toLocaleString() : '0';
    const curOut = current ? current.metrics.outputTokens.toLocaleString() : '0';
    const curTotal = current ? current.metrics.totalTokens.toLocaleString() : '0';
    const curCost = current ? `$${current.metrics.estimatedCostUsd.toFixed(4)}` : '$0.0000';

    const pricingLabel = pricing.isAutoDetected
      ? `⚡ Auto: ${pricing.modelName} ($${pricing.inputPerMillion}/1M In, $${pricing.outputPerMillion}/1M Out)`
      : `${pricing.modelName} ($${pricing.inputPerMillion}/1M In, $${pricing.outputPerMillion}/1M Out)`;

    const modelBadge = current?.detectedModelName ? ` | 🤖 ${current.detectedModelName}` : '';

    const modelCount = Object.keys(stats.byModel || {}).length;
    const modelSummary = Object.values(stats.byModel || {})
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 3)
      .map((m) => `${m.modelName}: ${(m.totalTokens / 1000).toFixed(1)}k`)
      .join(' | ');

    const items: vscode.QuickPickItem[] = [
      {
        label: '$(dashboard) Current Session Stats',
        description: `${curTotal} tokens (${curCost})`,
        detail: `📥 In: ${curIn} | 📤 Out: ${curOut} | 💬 Msgs: ${current?.userMessageCount || 0}${modelBadge} | 🛠️ Tools: ${current?.toolCallCount || 0}`,
      },
      {
        label: '$(graph) Token Usage by Model',
        description: `${modelCount} model(s) tracked`,
        detail: modelSummary || 'View breakdown of tokens and cost per AI model',
      },
      {
        label: '$(calendar) Today & All-Time Stats',
        description: `Today: ${stats.today.totalTokens.toLocaleString()} | All-Time: ${stats.allTime.totalTokens.toLocaleString()}`,
        detail: `Today Cost: $${stats.today.estimatedCostUsd.toFixed(4)} | All-Time Cost: $${stats.allTime.estimatedCostUsd.toFixed(4)} (${stats.totalConversationsTracked} sessions)`,
      },
      {
        label: '$(refresh) Reset Current Session Counter',
        description: 'Zero out the current session counter offset',
      },
      {
        label: '$(gear) Change Pricing Model Profile',
        description: `Current: ${pricingLabel}`,
      },
      {
        label: '$(paintcan) Change Status Bar Format',
        description: 'Switch between Compact, Detailed, Total-Only, or With-Cost',
      },
      {
        label: '$(export) Export Usage Report',
        description: 'Save Markdown / CSV summary report to workspace',
      },
      {
        label: '$(sync) Rescan Brain Logs',
        description: 'Force re-scan and reload all conversation logs',
      },
      {
        label: '$(folder) Open Brain Directory',
        description: 'Open Antigravity conversation log folder in OS Explorer',
      },
    ];

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: '⚡ Antigravity Token Counter Menu',
    });

    if (!selection) return;

    if (selection.label.includes('Current Session Stats')) {
      if (current) {
        const modelInfo = current.detectedModelName ? ` [Model: ${current.detectedModelName}]` : '';
        vscode.window.showInformationMessage(
          `🤖 Active Session [${current.conversationId.slice(0, 8)}]${modelInfo}: ${current.metrics.totalTokens.toLocaleString()} tokens ($${current.metrics.estimatedCostUsd.toFixed(4)}) - In: ${current.metrics.inputTokens.toLocaleString()} / Out: ${current.metrics.outputTokens.toLocaleString()}`
        );
      } else {
        vscode.window.showInformationMessage('No active Antigravity session detected.');
      }
    } else if (selection.label.includes('Token Usage by Model')) {
      await QuickPickManager.showModelBreakdown(stateManager);
    } else if (selection.label.includes('Reset Current Session Counter')) {
      stateManager.resetCurrentSession();
      vscode.window.showInformationMessage('Current session token counter has been reset to 0.');
    } else if (selection.label.includes('Change Pricing Model Profile')) {
      await QuickPickManager.showPricingSelector();
    } else if (selection.label.includes('Change Status Bar Format')) {
      await QuickPickManager.showFormatSelector();
    } else if (selection.label.includes('Export Usage Report')) {
      await QuickPickManager.exportReport(stateManager);
    } else if (selection.label.includes('Rescan Brain Logs')) {
      const config = vscode.workspace.getConfiguration();
      const customBrain = config.get<string>(CONFIG_KEYS.BRAIN_PATH);
      await logWatcher.scanAndWatch(customBrain || getDefaultBrainDirectory(), stateManager.getPricingRates());
      vscode.window.showInformationMessage('Antigravity conversation logs rescanned successfully.');
    } else if (selection.label.includes('Open Brain Directory')) {
      const config = vscode.workspace.getConfiguration();
      const customBrain = config.get<string>(CONFIG_KEYS.BRAIN_PATH);
      const targetDir = customBrain?.trim() || getDefaultBrainDirectory();
      vscode.env.openExternal(vscode.Uri.file(targetDir));
    }
  }

  /**
   * Displays per-model token analytics breakdown
   */
  public static async showModelBreakdown(stateManager: StateManager): Promise<void> {
    const stats = stateManager.getAggregatedStats();
    const byModel = stats.byModel || {};
    const totalAllTokens = stats.allTime.totalTokens || 1;

    const modelsList = Object.values(byModel).sort((a, b) => b.totalTokens - a.totalTokens);

    if (modelsList.length === 0) {
      vscode.window.showInformationMessage('No model breakdown data available yet.');
      return;
    }

    const items: vscode.QuickPickItem[] = modelsList.map((m) => {
      const pct = Math.round((m.totalTokens / totalAllTokens) * 100);
      return {
        label: `$(hubot) ${m.modelName}`,
        description: `${m.totalTokens.toLocaleString()} tokens (${pct}%) — $${m.estimatedCostUsd.toFixed(4)}`,
        detail: `📥 In: ${m.inputTokens.toLocaleString()} | 📤 Out: ${m.outputTokens.toLocaleString()} | 📁 ${m.sessionCount || 1} conversation session(s)`,
      };
    });

    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: '📊 Token Usage Breakdown by AI Model (Click to view details)',
    });

    if (choice) {
      const modelName = choice.label.replace('$(hubot) ', '').trim();
      const matched = modelsList.find((m) => m.modelName === modelName);
      if (matched) {
        vscode.window.showInformationMessage(
          `🤖 ${matched.modelName}: ${matched.totalTokens.toLocaleString()} total tokens (In: ${matched.inputTokens.toLocaleString()}, Out: ${matched.outputTokens.toLocaleString()}) | Est. Cost: $${matched.estimatedCostUsd.toFixed(4)} across ${matched.sessionCount || 1} sessions.`
        );
      }
    }
  }

  private static async showPricingSelector(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const currentConfigKey = config.get<string>(CONFIG_KEYS.MODEL_PRICING, 'auto');

    const options: Array<{ label: string; description: string; detail?: string; key: string }> = [
      {
        label: '$(sparkle) Auto-Detect Model (Recommended)',
        description: 'Automatically detects active model from conversation log',
        detail: currentConfigKey === 'auto' ? '✓ Currently Active' : undefined,
        key: 'auto',
      },
      ...Object.entries(MODEL_PRICING_TABLE).map(([key, value]) => ({
        label: value.name,
        description: `$${value.inputPerMillion}/1M In, $${value.outputPerMillion}/1M Out`,
        detail: currentConfigKey === key ? '✓ Currently Active' : undefined,
        key,
      })),
    ];

    const choice = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select a Model Pricing Profile to estimate token costs',
    });

    if (choice) {
      await vscode.workspace
        .getConfiguration()
        .update(CONFIG_KEYS.MODEL_PRICING, choice.key, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Updated pricing profile to ${choice.label}.`);
    }
  }

  private static async showFormatSelector(): Promise<void> {
    const formats = [
      { label: 'Compact', description: 'In: 12.4k | Out: 3.2k', key: STATUS_BAR_FORMATS.COMPACT },
      { label: 'Detailed', description: '📥 12,410 | 📤 3,250 ($0.002)', key: STATUS_BAR_FORMATS.DETAILED },
      { label: 'Total Only', description: '15.6k tokens', key: STATUS_BAR_FORMATS.TOTAL_ONLY },
      { label: 'With Cost', description: '15.6k ($0.002)', key: STATUS_BAR_FORMATS.WITH_COST },
    ];

    const choice = await vscode.window.showQuickPick(formats, {
      placeHolder: 'Select status bar display format',
    });

    if (choice) {
      await vscode.workspace
        .getConfiguration()
        .update(CONFIG_KEYS.STATUS_BAR_FORMAT, choice.key, vscode.ConfigurationTarget.Global);
    }
  }

  public static async exportReport(stateManager: StateManager): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Markdown Report (.md)', format: 'md' },
        { label: 'CSV Spreadsheet (.csv)', format: 'csv' },
      ],
      { placeHolder: 'Choose report export format' }
    );

    if (!choice) return;

    const stats = stateManager.getAggregatedStats();
    const sessions = stateManager.getAllSessions();
    const pricing = stateManager.getPricingRates();

    let content = '';

    if (choice.format === 'md') {
      content = ReportExporter.generateMarkdownReport(stats, sessions, pricing);
    } else {
      content = ReportExporter.generateCsvReport(sessions, pricing);
    }

    const doc = await vscode.workspace.openTextDocument({
      content,
      language: choice.format === 'md' ? 'markdown' : 'csv',
    });
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Generated ${choice.label} in editor. You can save or share it.`);
  }
}
