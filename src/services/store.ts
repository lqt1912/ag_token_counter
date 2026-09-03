import * as fs from 'fs';
import * as path from 'path';
import { ConversationSession } from '../types';
import { getDataStorePath } from '../constants';

export interface DataStoreSchema {
  version: number;
  lastSaved: number;
  sessions: Record<string, ConversationSession>;
}

export class DataStoreService {
  private static instance: DataStoreService | null = null;
  private filePath: string;
  private data: DataStoreSchema;
  private isDirty = false;

  private constructor() {
    this.filePath = getDataStorePath();
    this.data = {
      version: 1,
      lastSaved: Date.now(),
      sessions: {},
    };
    this.load();
  }

  public static getInstance(): DataStoreService {
    if (!DataStoreService.instance) {
      DataStoreService.instance = new DataStoreService();
    }
    return DataStoreService.instance;
  }

  public load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.sessions) {
          this.data = parsed;
        }
      }
    } catch (err) {
      console.warn('[DataStoreService] Error loading data-store.json:', err);
    }
  }

  public getSession(conversationId: string): ConversationSession | undefined {
    return this.data.sessions[conversationId];
  }

  public setSession(session: ConversationSession): void {
    this.data.sessions[session.conversationId] = session;
    this.isDirty = true;
  }

  public hasSession(conversationId: string): boolean {
    return !!this.data.sessions[conversationId];
  }

  public getAllSessions(): ConversationSession[] {
    return Object.values(this.data.sessions);
  }

  public save(): void {
    if (!this.isDirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.data.lastSaved = Date.now();
      const jsonContent = JSON.stringify(this.data, null, 2);

      // Safe atomic write on Windows
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, jsonContent, 'utf8');
      try {
        fs.renameSync(tempPath, this.filePath);
      } catch {
        // Fallback for Windows if target file is momentarily busy
        fs.writeFileSync(this.filePath, jsonContent, 'utf8');
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch {}
        }
      }

      this.isDirty = false;
    } catch (err) {
      console.error('[DataStoreService] Error saving data-store.json:', err);
    }
  }
}
