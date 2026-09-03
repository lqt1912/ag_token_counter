import { TokenizerService } from '../src/services/tokenizer';
import { TranscriptParser } from '../src/services/transcriptParser';

async function runTests() {
  console.log('--- Running Antigravity Token Counter Verification Tests ---');

  const tokenizer = TokenizerService.getInstance();

  // Test 1: Basic English Tokenization
  const englishText = "Hello, this is a test prompt for Antigravity AI coding assistant.";
  const englishTokens = tokenizer.countTokens(englishText);
  console.log(`[Test 1] English Text: "${englishText}" -> Tokens: ${englishTokens}`);
  if (englishTokens <= 0 || englishTokens > 30) {
    throw new Error(`Unexpected english token count: ${englishTokens}`);
  }

  // Test 2: Vietnamese Text Tokenization
  const vietnameseText = "Tôi muốn đếm token input và output trong Antigravity IDE.";
  const vnTokens = tokenizer.countTokens(vietnameseText);
  console.log(`[Test 2] Vietnamese Text: "${vietnameseText}" -> Tokens: ${vnTokens}`);
  if (vnTokens <= 0 || vnTokens > 40) {
    throw new Error(`Unexpected vietnamese token count: ${vnTokens}`);
  }

  // Test 3: Code Snippet Tokenization
  const codeSnippet = `
    function calculateTotal(a: number, b: number): number {
      return a + b;
    }
  `;
  const codeTokens = tokenizer.countTokens(codeSnippet);
  console.log(`[Test 3] Code Snippet -> Tokens: ${codeTokens}`);
  if (codeTokens <= 0) {
    throw new Error(`Unexpected code token count: ${codeTokens}`);
  }

  // Test 4: Pricing Cost Calculation
  const parser = new TranscriptParser();
  const cost = parser.calculateCost(100_000, 20_000, {
    modelName: 'Gemini 2.0 Flash',
    inputPerMillion: 0.10,
    outputPerMillion: 0.40,
  });
  console.log(`[Test 4] Cost for 100k In / 20k Out on Gemini 2.0 Flash -> $${cost}`);
  // 100k in = 0.1 * 0.1 = 0.01; 20k out = 0.02 * 0.4 = 0.008; total = 0.018
  if (Math.abs(cost - 0.018) > 0.001) {
    throw new Error(`Cost calculation mismatch: expected ~0.018, got ${cost}`);
  }

  // Test 5: Gemini 3.7 Flash Pricing
  const g37Cost = parser.calculateCost(1_000_000, 1_000_000, {
    modelName: 'Gemini 3.7 Flash',
    inputPerMillion: 0.75,
    outputPerMillion: 3.75,
  });
  console.log(`[Test 5] Cost for 1M In / 1M Out on Gemini 3.7 Flash -> $${g37Cost}`);
  if (Math.abs(g37Cost - 4.50) > 0.001) {
    throw new Error(`Cost calculation mismatch: expected 4.50, got ${g37Cost}`);
  }

  // Test 6: Multi-Model Transcript Parsing & Step Tracking
  const os = await import('os');
  const path = await import('path');
  const fs = await import('fs');

  const tempLogDir = path.join(os.tmpdir(), `ag_test_${Date.now()}`);
  fs.mkdirSync(tempLogDir, { recursive: true });
  const mockTranscriptPath = path.join(tempLogDir, 'transcript.jsonl');

  const mockLines = [
    JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '<USER_SETTINGS_CHANGE> The user changed setting Model Selection from None to Gemini 3.7 Flash. </USER_SETTINGS_CHANGE>\nHello Gemini, write a python function.',
    }),
    JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'def hello_world(): return "hello"',
      tool_calls: [{ name: 'write_to_file', args: { path: 'app.py' } }],
    }),
    JSON.stringify({
      step_index: 2,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '<USER_SETTINGS_CHANGE> The user changed setting Model Selection from Gemini 3.7 Flash to Claude 3.7 Sonnet. </USER_SETTINGS_CHANGE>\nNow Claude, refactor this code.',
    }),
    JSON.stringify({
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'def hello_world_v2(): return "hello Claude"',
    }),
  ];

  fs.writeFileSync(mockTranscriptPath, mockLines.join('\n'), 'utf8');

  const parsedSession = await parser.parseFile(mockTranscriptPath, 'test-conv-123', {
    modelName: 'Auto-Detect',
    inputPerMillion: 0.75,
    outputPerMillion: 3.75,
    isAutoDetected: true,
  });

  console.log('[Test 6] Multi-Model Parsed Result:', {
    conversationId: parsedSession?.conversationId,
    totalTokens: parsedSession?.metrics.totalTokens,
    estCost: parsedSession?.metrics.estimatedCostUsd,
    detectedModel: parsedSession?.detectedModel,
    detectedModelName: parsedSession?.detectedModelName,
    breakdownKeys: parsedSession?.modelBreakdown ? Object.keys(parsedSession.modelBreakdown) : [],
  });

  if (!parsedSession || !parsedSession.modelBreakdown) {
    throw new Error('Expected parsedSession with modelBreakdown');
  }

  if (!parsedSession.modelBreakdown['gemini-3.7-flash'] || !parsedSession.modelBreakdown['claude-3-7-sonnet']) {
    throw new Error('Expected breakdown for both gemini-3.7-flash and claude-3-7-sonnet');
  }

  const geminiStats = parsedSession.modelBreakdown['gemini-3.7-flash'];
  const claudeStats = parsedSession.modelBreakdown['claude-3-7-sonnet'];

  console.log(`[Test 6] Gemini 3.7 Flash -> In: ${geminiStats.inputTokens}, Out: ${geminiStats.outputTokens}, Cost: $${geminiStats.estimatedCostUsd}`);
  console.log(`[Test 6] Claude 3.7 Sonnet -> In: ${claudeStats.inputTokens}, Out: ${claudeStats.outputTokens}, Cost: $${claudeStats.estimatedCostUsd}`);

  if (geminiStats.totalTokens <= 0 || claudeStats.totalTokens <= 0) {
    throw new Error('Expected positive token counts for both models');
  }

  // Cleanup temp files
  try {
    fs.unlinkSync(mockTranscriptPath);
    fs.rmdirSync(tempLogDir);
  } catch {}

  console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

