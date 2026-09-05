use std::path::PathBuf;

pub const DEFAULT_MODEL_KEY: &str = "gemini-3.7-flash";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelPricing {
    pub name: String,
    pub input_per_million: f64,
    pub output_per_million: f64,
}

pub fn get_default_brain_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".gemini").join("antigravity-ide").join("brain"))
}

pub fn resolve_model_pricing(raw: &str) -> (&'static str, &'static str, f64, f64) {
    let lower = raw.to_lowercase();
    let norm = lower.trim();

    if norm.contains("3.8") && norm.contains("cyber") {
        ("gemini-3.8-flash-cyber", "Gemini 3.8 Flash Cyber", 0.75, 3.75)
    } else if norm.contains("3.8") {
        ("gemini-3.8-flash", "Gemini 3.8 Flash", 0.75, 3.75)
    } else if norm.contains("3.7") && norm.contains("sonnet") {
        ("claude-3-7-sonnet", "Claude 3.7 Sonnet", 3.00, 15.00)
    } else if norm.contains("3.7") {
        ("gemini-3.7-flash", "Gemini 3.7 Flash", 0.75, 3.75)
    } else if norm.contains("3.6") {
        ("gemini-3.6-flash", "Gemini 3.6 Flash", 0.75, 3.75)
    } else if norm.contains("3.5") && norm.contains("sonnet") {
        ("claude-3-5-sonnet", "Claude 3.5 Sonnet", 3.00, 15.00)
    } else if norm.contains("opus") {
        ("claude-opus-4-6", "Claude Opus 4.6", 5.00, 25.00)
    } else if norm.contains("gpt-4o-mini") {
        ("gpt-4o-mini", "GPT-4o Mini", 0.15, 0.60)
    } else if norm.contains("gpt-4o") {
        ("gpt-4o", "GPT-4o", 2.50, 10.00)
    } else if norm.contains("1.5-pro") {
        ("gemini-1.5-pro", "Gemini 1.5 Pro", 1.25, 5.00)
    } else {
        ("gemini-3.7-flash", "Gemini 3.7 Flash", 0.75, 3.75)
    }
}
