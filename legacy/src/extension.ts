import * as vscode from 'vscode';
import { COMMANDS, CONFIG_KEYS } from './constants';
import { LogWatcher } from './services/logWatcher';
import { StateManager } from './services/stateManager';
import { StatusBarManager } from './ui/statusBar';
import { QuickPickManager } from './ui/quickPick';

let logWatcher: LogWatcher | null = null;
let stateManager: StateManager | null = null;
let statusBarManager: StatusBarManager | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[AntigravityTokenCounter] Extension is activating...');

  stateManager = new StateManager(context);
  statusBarManager = new StatusBarManager();
  logWatcher = new LogWatcher();

  context.subscriptions.push(stateManager);
  context.subscriptions.push(statusBarManager);
  context.subscriptions.push(logWatcher);

  // Wire up state manager updates to status bar
  stateManager.onDidChangeStats((stats) => {
    if (statusBarManager && stateManager) {
      statusBarManager.update(stats, stateManager.getPricingRates());
    }
  });

  // Wire up watcher events to state manager
  logWatcher.onDidUpdateSession((session) => {
    stateManager?.updateCurrentSession(session);
  });

  logWatcher.onDidDiscoverSessions((sessions) => {
    stateManager?.setHistoricalSessions(sessions);
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SHOW_STATS, async () => {
      if (stateManager && logWatcher) {
        await QuickPickManager.showMenu(stateManager, logWatcher);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.RESET_SESSION, () => {
      stateManager?.resetCurrentSession();
      vscode.window.showInformationMessage('Current Antigravity session token counter reset.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPORT_REPORT, async () => {
      if (stateManager) {
        await QuickPickManager.exportReport(stateManager);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.REFRESH_WATCHER, async () => {
      if (logWatcher && stateManager) {
        const config = vscode.workspace.getConfiguration();
        const customBrain = config.get<string>(CONFIG_KEYS.BRAIN_PATH);
        const pollingInterval = config.get<number>(CONFIG_KEYS.POLLING_INTERVAL_MS, 1000);
        await logWatcher.start(customBrain, stateManager.getPricingRates(), pollingInterval);
        vscode.window.showInformationMessage('Antigravity Token Watcher refreshed.');
      }
    })
  );

  // Listen to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration(CONFIG_KEYS.BRAIN_PATH) ||
        e.affectsConfiguration(CONFIG_KEYS.MODEL_PRICING) ||
        e.affectsConfiguration(CONFIG_KEYS.CUSTOM_INPUT_COST) ||
        e.affectsConfiguration(CONFIG_KEYS.CUSTOM_OUTPUT_COST) ||
        e.affectsConfiguration(CONFIG_KEYS.STATUS_BAR_FORMAT) ||
        e.affectsConfiguration(CONFIG_KEYS.POLLING_INTERVAL_MS)
      ) {
        if (stateManager && statusBarManager && logWatcher) {
          const config = vscode.workspace.getConfiguration();
          const customBrain = config.get<string>(CONFIG_KEYS.BRAIN_PATH);
          const pollingInterval = config.get<number>(CONFIG_KEYS.POLLING_INTERVAL_MS, 1000);
          await logWatcher.start(customBrain, stateManager.getPricingRates(), pollingInterval);
          statusBarManager.update(stateManager.getAggregatedStats(), stateManager.getPricingRates());
        }
      }
    })
  );

  // Initial watcher start
  const config = vscode.workspace.getConfiguration();
  const customBrain = config.get<string>(CONFIG_KEYS.BRAIN_PATH);
  const pollingInterval = config.get<number>(CONFIG_KEYS.POLLING_INTERVAL_MS, 1000);
  
  await logWatcher.start(customBrain, stateManager.getPricingRates(), pollingInterval);
  
  // Initial UI refresh
  statusBarManager.update(stateManager.getAggregatedStats(), stateManager.getPricingRates());

  console.log('[AntigravityTokenCounter] Extension activated successfully.');
}

export function deactivate(): void {
  if (logWatcher) {
    logWatcher.stop();
  }
}
