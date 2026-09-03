import { getEncoding, Tiktoken } from 'js-tiktoken';

/**
 * High-performance Tokenizer Service
 * Utilizes pure JavaScript BPE (cl100k_base) compatible with modern LLMs (Gemini, Claude, GPT),
 * with fast memory cache and heuristic fallback.
 */
export class TokenizerService {
  private static instance: TokenizerService | null = null;
  private encoder: Tiktoken | null = null;
  private cache: Map<string, number> = new Map();
  private maxCacheSize = 1000;

  private constructor() {
    try {
      this.encoder = getEncoding('cl100k_base');
    } catch (error) {
      console.warn('[AntigravityTokenCounter] Failed to initialize Tiktoken encoder, falling back to heuristic tokenizer', error);
      this.encoder = null;
    }
  }

  public static getInstance(): TokenizerService {
    if (!TokenizerService.instance) {
      TokenizerService.instance = new TokenizerService();
    }
    return TokenizerService.instance;
  }

  /**
   * Calculates the number of tokens in a given text string.
   */
  public countTokens(text: string | null | undefined): number {
    if (!text || text.length === 0) {
      return 0;
    }

    // Fast path for short texts via cache
    if (text.length <= 128) {
      const cached = this.cache.get(text);
      if (cached !== undefined) {
        return cached;
      }
    }

    let tokenCount: number;

    if (this.encoder) {
      try {
        tokenCount = this.encoder.encode(text).length;
      } catch (err) {
        // Fallback to heuristic if encoding error occurs
        tokenCount = this.heuristicTokenCount(text);
      }
    } else {
      tokenCount = this.heuristicTokenCount(text);
    }

    if (text.length <= 128) {
      if (this.cache.size >= this.maxCacheSize) {
        // Evict oldest 20%
        const keysToDelete = Array.from(this.cache.keys()).slice(0, 200);
        keysToDelete.forEach((k) => this.cache.delete(k));
      }
      this.cache.set(text, tokenCount);
    }

    return tokenCount;
  }

  /**
   * Fast Heuristic Token Counter (fallback)
   * Accounts for English (avg 4 chars/token), Code (avg 3.5 chars/token),
   * and UTF-8 multibyte / Vietnamese / CJK (avg 1.5 - 2.5 chars/token).
   */
  public heuristicTokenCount(text: string): number {
    if (!text) return 0;

    let charCount = 0;
    let nonAsciiCount = 0;

    for (let i = 0; i < text.length; i++) {
      charCount++;
      if (text.charCodeAt(i) > 127) {
        nonAsciiCount++;
      }
    }

    // Words heuristic
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    
    // Weighted estimation
    const asciiChars = charCount - nonAsciiCount;
    const estimatedAsciiTokens = Math.ceil(asciiChars / 3.8);
    const estimatedNonAsciiTokens = Math.ceil(nonAsciiCount / 2.0);

    const baseEstimate = estimatedAsciiTokens + estimatedNonAsciiTokens;
    return Math.max(words, baseEstimate);
  }

  /**
   * Calculates tokens for an object or argument payload (JSON)
   */
  public countObjectTokens(obj: unknown): number {
    if (obj === null || obj === undefined) return 0;
    try {
      const jsonStr = typeof obj === 'string' ? obj : JSON.stringify(obj);
      return this.countTokens(jsonStr);
    } catch {
      return 0;
    }
  }
}
