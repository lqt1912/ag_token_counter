import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConversationSession, PricingRates } from '../types';
import { TranscriptParser } from './transcriptParser';
import { getDefaultBrainDirectory, resolveModelPricing, DEFAULT_MODEL_KEY } from '../constants';

export class LogWatcher implements vscode.Disposable {
  private parser: TranscriptParser;
  private currentWatcher: fs.FSWatcher | null = null;
  private currentActiveConversationId: string | null = null;
  private currentActiveFilePath: string | null = null;
  private pollingTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];

  private _onDidUpdateSession = new vscode.EventEmitter<ConversationSession>();
  public readonly onDidUpdateSession = this._onDidUpdateSession.event;

  private _onDidDiscoverSessions = new vscode.EventEmitter<ConversationSession[]>();
  public readonly onDidDiscoverSessions = this._onDidDiscoverSessions.event;

  constructor() {
    this.parser = new TranscriptParser();
  }

  /**
   * Starts monitoring the brain directory.
   */
  public async start(brainPathOverride?: string, pricing?: PricingRates, pollingIntervalMs = 1000): Promise<void> {
    this.stop();

    const brainDir = brainPathOverride?.trim() || getDefaultBrainDirectory();

    if (!fs.existsSync(brainDir)) {
      console.warn(`[AntigravityTokenCounter] Brain directory not found at: ${brainDir}`);
      // Retry in background periodically in case Antigravity creates it
      this.pollingTimer = setInterval(() => {
        if (fs.existsSync(brainDir)) {
          this.start(brainPathOverride, pricing, pollingIntervalMs);
        }
      }, 5000);
      return;
    }

    // Initial scan of active and historical sessions
    await this.scanAndWatch(brainDir, pricing);

    // Periodic check to detect new conversations or workspace switches
    this.pollingTimer = setInterval(async () => {
      await this.checkForNewerConversation(brainDir, pricing);
    }, Math.max(1000, pollingIntervalMs));
  }

  /**
   * Scans all conversation directories in brain folder and sets up watcher on the newest one.
   */
  public async scanAndWatch(brainDir: string, pricing?: PricingRates): Promise<ConversationSession | null> {
    const defaultRate = resolveModelPricing(DEFAULT_MODEL_KEY);
    const currentPricing: PricingRates = pricing || {
      modelName: defaultRate.name,
      modelKey: defaultRate.key,
      inputPerMillion: defaultRate.inputPerMillion,
      outputPerMillion: defaultRate.outputPerMillion,
      isAutoDetected: true,
    };

    const conversationDirs = this.getConversationDirectories(brainDir);
    const sessions: ConversationSession[] = [];

    for (const dir of conversationDirs) {
      const convId = path.basename(dir);
      const transcriptFile = this.resolveTranscriptPath(dir);
      if (transcriptFile && fs.existsSync(transcriptFile)) {
        const session = await this.parser.parseFile(transcriptFile, convId, currentPricing);
        if (session) {
          sessions.push(session);
        }
      }
    }

    // Sort by latest updated timestamp descending
    sessions.sort((a, b) => b.lastUpdated - a.lastUpdated);

    if (sessions.length > 0) {
      this._onDidDiscoverSessions.fire(sessions);
      const latestSession = sessions[0];
      this.watchSessionFile(latestSession.transcriptPath, latestSession.conversationId, currentPricing);
      this._onDidUpdateSession.fire(latestSession);
      return latestSession;
    }

    return null;
  }

  /**
   * Checks if a newer conversation has been started and switches watcher if so.
   */
  private async checkForNewerConversation(brainDir: string, pricing?: PricingRates): Promise<void> {
    const defaultRate = resolveModelPricing(DEFAULT_MODEL_KEY);
    const currentPricing: PricingRates = pricing || {
      modelName: defaultRate.name,
      modelKey: defaultRate.key,
      inputPerMillion: defaultRate.inputPerMillion,
      outputPerMillion: defaultRate.outputPerMillion,
      isAutoDetected: true,
    };

    const dirs = this.getConversationDirectories(brainDir);
    let newestFile: string | null = null;
    let newestConvId: string | null = null;
    let newestMtime = 0;

    for (const dir of dirs) {
      const transcriptFile = this.resolveTranscriptPath(dir);
      if (transcriptFile && fs.existsSync(transcriptFile)) {
        try {
          const stats = fs.statSync(transcriptFile);
          if (stats.mtimeMs > newestMtime) {
            newestMtime = stats.mtimeMs;
            newestFile = transcriptFile;
            newestConvId = path.basename(dir);
          }
        } catch {
          // ignore
        }
      }
    }

    if (newestFile && newestConvId) {
      if (newestConvId !== this.currentActiveConversationId || newestFile !== this.currentActiveFilePath) {
        // Switched to newer conversation
        this.watchSessionFile(newestFile, newestConvId, currentPricing);
        const session = await this.parser.parseFile(newestFile, newestConvId, currentPricing);
        if (session) {
          this._onDidUpdateSession.fire(session);
        }
      } else {
        // Same conversation, reparse if file changed
        try {
          const stats = fs.statSync(newestFile);
          if (stats.mtimeMs > newestMtime - 50) {
            this.triggerDebouncedParse(newestFile, newestConvId, currentPricing);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Sets up file watching on the active transcript.jsonl
   */
  private watchSessionFile(filePath: string, conversationId: string, pricing: PricingRates): void {
    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }

    this.currentActiveFilePath = filePath;
    this.currentActiveConversationId = conversationId;

    try {
      this.currentWatcher = fs.watch(filePath, { persistent: false }, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          this.triggerDebouncedParse(filePath, conversationId, pricing);
        }
      });
    } catch (err) {
      console.warn(`[AntigravityTokenCounter] fs.watch not supported for ${filePath}, falling back to polling`, err);
    }
  }

  private triggerDebouncedParse(filePath: string, conversationId: string, pricing: PricingRates): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      const session = await this.parser.parseFile(filePath, conversationId, pricing);
      if (session) {
        this._onDidUpdateSession.fire(session);
      }
    }, 250);
  }

  /**
   * Helper to locate conversation directories
   */
  private getConversationDirectories(brainDir: string): string[] {
    try {
      if (!fs.existsSync(brainDir)) return [];
      const entries = fs.readdirSync(brainDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && entry.name !== 'scratch')
        .map((entry) => path.join(brainDir, entry.name));
    } catch (err) {
      return [];
    }
  }

  /**
   * Locates the transcript.jsonl path inside a conversation directory
   */
  private resolveTranscriptPath(convDir: string): string | null {
    const defaultTranscript = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(defaultTranscript)) {
      return defaultTranscript;
    }

    const fullTranscript = path.join(convDir, '.system_generated', 'logs', 'transcript_full.jsonl');
    if (fs.existsSync(fullTranscript)) {
      return fullTranscript;
    }

    // Direct transcript in dir
    const directTranscript = path.join(convDir, 'transcript.jsonl');
    if (fs.existsSync(directTranscript)) {
      return directTranscript;
    }

    return null;
  }

  public stop(): void {
    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  public dispose(): void {
    this.stop();
    this._onDidUpdateSession.dispose();
    this._onDidDiscoverSessions.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
