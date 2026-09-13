namespace AntigravityTokenTray.Models;

public class TokenUsage
{
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long TotalTokens => InputTokens + OutputTokens;
    public long TranscriptInputTokens { get; set; }
    public long TranscriptOutputTokens { get; set; }
    public int RequestCount { get; set; }
}

public sealed class ModelUsage : TokenUsage
{
    public string Model { get; set; } = "Unknown";
    public int SessionCount { get; set; }
    public int StepCount { get; set; }
}

public sealed class ConversationUsage
{
    public string SessionId { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string Title { get; set; } = "Conversation";
    public DateTime LastUpdated { get; set; }
    public string Model { get; set; } = "Gemini 3.7 Flash";
    public TokenUsage Usage { get; set; } = new();
    public Dictionary<string, ModelUsage> ByModel { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class UsageSnapshot
{
    public DateTime Timestamp { get; set; } = DateTime.Now;
    public string BrainDirectory { get; set; } = "";
    public ConversationUsage? CurrentSession { get; set; }
    public TokenUsage Today { get; set; } = new();
    public TokenUsage AllTime { get; set; } = new();
    public List<ModelUsage> TodayByModel { get; set; } = new();
    public List<ModelUsage> AllTimeByModel { get; set; } = new();
    public int SessionCount { get; set; }
}
