use std::path::PathBuf;

pub fn get_default_brain_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".gemini").join("antigravity-ide").join("brain"))
}

pub fn resolve_model_pricing(raw: &str) -> (&'static str, &'static str, f64, f64) {
    let lower = raw.to_lowercase();
    let norm = lower.trim();

    let is_gemini = norm.contains("gemini");
    let is_claude = norm.contains("claude");

    if is_claude && (norm.contains("4.6") || norm.contains("4-6")) && norm.contains("opus") {
        ("claude-opus-4-6", "Claude Opus 4.6", 5.00, 25.00)
    } else if is_claude && (norm.contains("4.6") || norm.contains("4-6")) && norm.contains("sonnet")
    {
        ("claude-sonnet-4-6", "Claude Sonnet 4.6", 3.00, 15.00)
    } else if is_claude && (norm.contains("3.7") || norm.contains("3-7")) && norm.contains("sonnet")
    {
        ("claude-3-7-sonnet", "Claude 3.7 Sonnet", 3.00, 15.00)
    } else if is_claude && (norm.contains("3.5") || norm.contains("3-5")) && norm.contains("sonnet")
    {
        ("claude-3-5-sonnet", "Claude 3.5 Sonnet", 3.00, 15.00)
    } else if is_claude && norm.contains("haiku") {
        ("claude-3-5-haiku", "Claude 3.5 Haiku", 0.80, 4.00)
    } else if is_gemini && norm.contains("3.8") && norm.contains("cyber") {
        (
            "gemini-3.8-flash-cyber",
            "Gemini 3.8 Flash Cyber",
            0.75,
            3.75,
        )
    } else if is_gemini && norm.contains("3.8") {
        ("gemini-3.8-flash", "Gemini 3.8 Flash", 0.75, 3.75)
    } else if is_gemini && norm.contains("3.7") {
        ("gemini-3.7-flash", "Gemini 3.7 Flash", 0.75, 3.75)
    } else if is_gemini && norm.contains("3.6") {
        ("gemini-3.6-flash", "Gemini 3.6 Flash", 0.75, 3.75)
    } else if is_gemini && norm.contains("3.5") {
        ("gemini-3.5-flash", "Gemini 3.5 Flash", 1.50, 9.00)
    } else if is_gemini && norm.contains("3.1") {
        ("gemini-3.1-pro", "Gemini 3.1 Pro", 2.00, 12.00)
    } else if is_gemini && norm.contains("2.0") && norm.contains("lite") {
        (
            "gemini-2.0-flash-lite",
            "Gemini 2.0 Flash Lite",
            0.075,
            0.30,
        )
    } else if is_gemini && norm.contains("2.0") && norm.contains("flash") {
        ("gemini-2.0-flash", "Gemini 2.0 Flash", 0.10, 0.40)
    } else if is_gemini && norm.contains("1.5") && norm.contains("pro") {
        ("gemini-1.5-pro", "Gemini 1.5 Pro", 1.25, 5.00)
    } else if is_gemini && norm.contains("1.5") && norm.contains("flash") {
        ("gemini-1.5-flash", "Gemini 1.5 Flash", 0.075, 0.30)
    } else if norm.contains("gpt-oss") || norm.contains("gpt oss") || norm.contains("120b") {
        ("gpt-oss-120b", "GPT-OSS 120B", 0.90, 0.90)
    } else if norm.contains("gpt-4o-mini") {
        ("gpt-4o-mini", "GPT-4o Mini", 0.15, 0.60)
    } else if norm.contains("gpt-4o") {
        ("gpt-4o", "GPT-4o", 2.50, 10.00)
    } else if is_claude && norm.contains("opus") {
        ("claude-opus-4-6", "Claude Opus 4.6", 5.00, 25.00)
    } else if is_claude && norm.contains("sonnet") {
        ("claude-sonnet-4-6", "Claude Sonnet 4.6", 3.00, 15.00)
    } else {
        ("gemini-3.7-flash", "Gemini 3.7 Flash", 0.75, 3.75)
    }
}
