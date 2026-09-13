using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.IO;
using AntigravityTokenTray.Models;

namespace AntigravityTokenTray;

public sealed class AntigravityLogReader
{
    private const string DefaultModelKey = "gemini-3.7-flash";
    private const string DefaultModelName = "Gemini 3.7 Flash";
    private static readonly HashSet<string> ToolResultTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "VIEW_FILE", "GREP_SEARCH", "RUN_COMMAND", "CODE_ACTION", "LIST_DIRECTORY",
        "SEARCH_WEB", "BROWSER_SUBAGENT", "GENERATE_IMAGE", "READ_URL_CONTENT"
    };
    private static readonly Regex SettingsBlock = new(@"<USER_SETTINGS_CHANGE>(.*?)</USER_SETTINGS_CHANGE>", RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex ModelSelection = new(@"Model\s+Selection.*?\bto\s+([A-Za-z0-9\s\-\.\(\)]+?)(?:\.\s+No need|\.\s*$|\.\s*\n|\.\s*<|\r|\n|<|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ModelTag = new(@"<(?:model_selection|model_name|model)>([^<]+)</", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private readonly Dictionary<string, (long Ticks, long Length, ConversationUsage Usage)> _cache = new(StringComparer.OrdinalIgnoreCase);
    private string? _customPath;

    private sealed class RawStep
    {
        [JsonPropertyName("type")] public string? Type { get; set; }
        [JsonPropertyName("source")] public string? Source { get; set; }
        [JsonPropertyName("content")] public string? Content { get; set; }
        [JsonPropertyName("thinking")] public string? Thinking { get; set; }
        [JsonPropertyName("tool_calls")] public JsonElement? ToolCalls { get; set; }
        [JsonPropertyName("model")] public string? Model { get; set; }
        [JsonPropertyName("model_name")] public string? ModelName { get; set; }
        [JsonPropertyName("metadata")] public JsonElement? Metadata { get; set; }
    }

    public AntigravityLogReader(string? customPath = null) => _customPath = customPath;

    public string? GetBrainDirectory()
    {
        if (!string.IsNullOrWhiteSpace(_customPath) && Directory.Exists(_customPath)) return _customPath;
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var path = Path.Combine(home, ".gemini", "antigravity-ide", "brain");
        return Directory.Exists(path) ? path : null;
    }

    public List<string> FindTranscriptFiles()
    {
        var root = GetBrainDirectory();
        if (root == null) return new();
        try
        {
            return Directory.EnumerateDirectories(root)
                .Where(d => Guid.TryParse(Path.GetFileName(d), out _))
                .Select(d => Path.Combine(d, ".system_generated", "logs", "transcript.jsonl"))
                .Where(File.Exists)
                .ToList();
        }
        catch { return new(); }
    }

    public UsageSnapshot ReadUsage()
    {
        var files = FindTranscriptFiles();
        var sessions = files.Select(ParseCached).Where(s => s != null).Cast<ConversationUsage>()
            .OrderByDescending(s => s.LastUpdated).ToList();
        var today = sessions.Where(s => s.LastUpdated.Date == DateTime.Now.Date).ToList();
        return new UsageSnapshot
        {
            BrainDirectory = GetBrainDirectory() ?? "Not found",
            CurrentSession = sessions.FirstOrDefault(),
            Today = Aggregate(today),
            AllTime = Aggregate(sessions),
            TodayByModel = AggregateModels(today),
            AllTimeByModel = AggregateModels(sessions),
            SessionCount = sessions.Count,
            Timestamp = DateTime.Now,
        };
    }

    private ConversationUsage? ParseCached(string path)
    {
        try
        {
            var info = new FileInfo(path);
            var ticks = info.LastWriteTimeUtc.Ticks;
            if (_cache.TryGetValue(path, out var cached) && cached.Ticks == ticks && cached.Length == info.Length) return cached.Usage;
            var usage = Parse(path);
            if (usage != null) _cache[path] = (ticks, info.Length, usage);
            return usage;
        }
        catch { return null; }
    }

    private static ConversationUsage? Parse(string path)
    {
        var session = new ConversationUsage
        {
            FilePath = path,
            SessionId = new DirectoryInfo(Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(path))!)!).Name,
            LastUpdated = File.GetLastWriteTime(path),
        };
        long contextTokens = 0;
        var modelKey = DefaultModelKey;
        var modelName = DefaultModelName;
        try
        {
            foreach (var line in File.ReadLines(path))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                RawStep? step;
                try { step = JsonSerializer.Deserialize<RawStep>(line); } catch { continue; }
                if (step == null) continue;
                var isUser = string.Equals(step.Type, "USER_INPUT", StringComparison.OrdinalIgnoreCase) || string.Equals(step.Source, "USER_EXPLICIT", StringComparison.OrdinalIgnoreCase);
                var isModel = string.Equals(step.Source, "MODEL", StringComparison.OrdinalIgnoreCase);
                var isToolResult = isModel && ToolResultTypes.Contains(step.Type ?? "");
                var isModelOutput = isModel && !isToolResult;
                var rawModel = ExtractModel(step, isUser);
                if (rawModel != null) (modelKey, modelName) = ResolveModel(rawModel);
                var metric = GetModel(session.ByModel, modelKey, modelName);
                metric.StepCount++;

                long stepInput = 0, stepOutput = 0;
                if (!string.IsNullOrEmpty(step.Content))
                {
                    var tokens = CountTokens(step.Content);
                    if (isUser || !isModel || isToolResult) stepInput += tokens;
                    else if (isModelOutput) stepOutput += tokens;
                    if (isUser && session.Usage.TranscriptInputTokens == 0)
                    {
                        var title = Regex.Replace(step.Content, @"<[^>]+>", " ").Trim();
                        session.Title = title.Length > 46 ? title[..43] + "..." : title;
                    }
                }
                if (isModel)
                {
                    if (!string.IsNullOrEmpty(step.Thinking)) stepOutput += CountTokens(step.Thinking);
                    if (step.ToolCalls is { ValueKind: JsonValueKind.Array } calls)
                    {
                        foreach (var call in calls.EnumerateArray()) stepOutput += CountTokens(call.GetRawText());
                    }
                }

                session.Usage.TranscriptInputTokens += stepInput;
                session.Usage.TranscriptOutputTokens += stepOutput;
                metric.TranscriptInputTokens += stepInput;
                metric.TranscriptOutputTokens += stepOutput;
                if (string.Equals(step.Type, "PLANNER_RESPONSE", StringComparison.OrdinalIgnoreCase))
                {
                    session.Usage.InputTokens += contextTokens;
                    session.Usage.RequestCount++;
                    metric.InputTokens += contextTokens;
                }
                session.Usage.OutputTokens += stepOutput;
                metric.OutputTokens += stepOutput;
                if (string.Equals(step.Type, "CHECKPOINT", StringComparison.OrdinalIgnoreCase) || string.Equals(step.Type, "CONVERSATION_HISTORY", StringComparison.OrdinalIgnoreCase)) contextTokens = stepInput + stepOutput;
                else contextTokens += stepInput + stepOutput;
            }
            session.Model = modelName;
            foreach (var metric in session.ByModel.Values) metric.SessionCount = 1;
            return session;
        }
        catch { return null; }
    }

    private static ModelUsage GetModel(Dictionary<string, ModelUsage> models, string key, string name)
    {
        if (!models.TryGetValue(key, out var metric))
        {
            metric = new ModelUsage { Model = name };
            models[key] = metric;
        }
        return metric;
    }

    private static TokenUsage Aggregate(List<ConversationUsage> sessions)
    {
        var total = new TokenUsage();
        foreach (var s in sessions)
        {
            total.InputTokens += s.Usage.InputTokens; total.OutputTokens += s.Usage.OutputTokens;
            total.TranscriptInputTokens += s.Usage.TranscriptInputTokens; total.TranscriptOutputTokens += s.Usage.TranscriptOutputTokens;
            total.RequestCount += s.Usage.RequestCount;
        }
        return total;
    }

    private static List<ModelUsage> AggregateModels(List<ConversationUsage> sessions)
    {
        var result = new Dictionary<string, ModelUsage>(StringComparer.OrdinalIgnoreCase);
        foreach (var session in sessions)
        foreach (var pair in session.ByModel)
        {
            if (!result.TryGetValue(pair.Key, out var target)) result[pair.Key] = target = new ModelUsage { Model = pair.Value.Model };
            target.InputTokens += pair.Value.InputTokens; target.OutputTokens += pair.Value.OutputTokens;
            target.TranscriptInputTokens += pair.Value.TranscriptInputTokens; target.TranscriptOutputTokens += pair.Value.TranscriptOutputTokens;
            target.RequestCount += pair.Value.RequestCount; target.SessionCount += 1; target.StepCount += pair.Value.StepCount;
        }
        return result.Values.OrderByDescending(x => x.TotalTokens).ToList();
    }

    private static string? ExtractModel(RawStep step, bool isUser)
    {
        if (!string.IsNullOrWhiteSpace(step.Model)) return step.Model.Trim();
        if (!string.IsNullOrWhiteSpace(step.ModelName)) return step.ModelName.Trim();
        if (step.Metadata is { ValueKind: JsonValueKind.Object } metadata)
        {
            foreach (var key in new[] { "model", "model_name" }) if (metadata.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())) return value.GetString()!.Trim();
        }
        if (!isUser || string.IsNullOrEmpty(step.Content)) return null;
        var target = SettingsBlock.Match(step.Content).Success ? SettingsBlock.Match(step.Content).Groups[1].Value : step.Content;
        var selection = ModelSelection.Match(target);
        if (selection.Success && !selection.Groups[1].Value.Trim().Equals("none", StringComparison.OrdinalIgnoreCase)) return selection.Groups[1].Value.Trim(' ', '`', '"', '\'');
        var tag = ModelTag.Match(step.Content);
        return tag.Success ? tag.Groups[1].Value.Trim() : null;
    }

    private static (string Key, string Name) ResolveModel(string raw)
    {
        var n = raw.ToLowerInvariant().Trim();
        if (n.Contains("claude") && n.Contains("opus")) return ("claude-opus", "Claude Opus");
        if (n.Contains("claude") && n.Contains("sonnet")) return ("claude-sonnet", "Claude Sonnet");
        if (n.Contains("claude") && n.Contains("haiku")) return ("claude-haiku", "Claude Haiku");
        if (n.Contains("gemini") && n.Contains("3.8")) return ("gemini-3.8-flash", "Gemini 3.8 Flash");
        if (n.Contains("gemini") && n.Contains("3.7")) return ("gemini-3.7-flash", "Gemini 3.7 Flash");
        if (n.Contains("gemini") && n.Contains("3.6")) return ("gemini-3.6-flash", "Gemini 3.6 Flash");
        if (n.Contains("gemini") && n.Contains("3.5")) return ("gemini-3.5-flash", "Gemini 3.5 Flash");
        if (n.Contains("gemini") && n.Contains("3.1")) return ("gemini-3.1-pro", "Gemini 3.1 Pro");
        if (n.Contains("gemini") && n.Contains("2.0") && n.Contains("lite")) return ("gemini-2.0-flash-lite", "Gemini 2.0 Flash Lite");
        if (n.Contains("gemini") && n.Contains("2.0")) return ("gemini-2.0-flash", "Gemini 2.0 Flash");
        if (n.Contains("gemini") && n.Contains("1.5") && n.Contains("pro")) return ("gemini-1.5-pro", "Gemini 1.5 Pro");
        if (n.Contains("gemini") && n.Contains("1.5")) return ("gemini-1.5-flash", "Gemini 1.5 Flash");
        if (n.Contains("gpt-4o-mini")) return ("gpt-4o-mini", "GPT-4o Mini");
        if (n.Contains("gpt-4o")) return ("gpt-4o", "GPT-4o");
        return (DefaultModelKey, DefaultModelName);
    }

    private static long CountTokens(string text)
    {
        if (string.IsNullOrEmpty(text)) return 0;
        long ascii = 0, nonAscii = 0;
        foreach (var c in text) if (c <= 127) ascii++; else nonAscii++;
        var words = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
        var estimate = (long)Math.Ceiling(ascii / 3.8) + (long)Math.Ceiling(nonAscii / 2.0);
        return Math.Max(words, estimate);
    }

    public static string FormatNumber(long value) => value.ToString("N0");
}
