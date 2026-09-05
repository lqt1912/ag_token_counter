use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::SystemTime;
use regex::Regex;
use serde::{Deserialize, Serialize};
use crate::constants::{get_default_brain_dir, resolve_model_pricing};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenMetrics {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSession {
    pub conversation_id: String,
    pub title: String,
    pub last_updated: u64,
    pub step_count: usize,
    pub user_message_count: usize,
    pub detected_model: Option<String>,
    pub detected_model_name: Option<String>,
    pub metrics: TokenMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchAllStatsResponse {
    pub sessions: Vec<ConversationSession>,
    pub current_session: Option<ConversationSession>,
    pub total_supported_models: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct RawStep {
    #[serde(rename = "type")]
    step_type: Option<String>,
    source: Option<String>,
    content: Option<String>,
    tool_calls: Option<Vec<serde_json::Value>>,
}

// Fast approximate tokenizer: ~1 token per 3.8 characters or byte length fallback
fn count_tokens(text: &str) -> u64 {
    if text.is_empty() {
        return 0;
    }
    let chars = text.chars().count();
    ((chars as f64) / 3.85).ceil() as u64
}

pub fn parse_all_sessions(limit: usize) -> FetchAllStatsResponse {
    let brain_dir = match get_default_brain_dir() {
        Some(dir) if dir.exists() => dir,
        _ => {
            return FetchAllStatsResponse {
                sessions: vec![],
                current_session: None,
                total_supported_models: 20,
                error: Some("Brain directory not found".into()),
            };
        }
    };

    let uuid_regex = Regex::new(r"^[a-f0-9\-]{36}$").unwrap();
    let mut dirs_list: Vec<(String, u64)> = vec![];

    if let Ok(entries) = std::fs::read_dir(&brain_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if uuid_regex.is_match(name) {
                        let mtime = entry.metadata()
                            .and_then(|m| m.modified())
                            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH))
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        dirs_list.push((name.to_string(), mtime));
                    }
                }
            }
        }
    }

    dirs_list.sort_by(|a, b| b.1.cmp(&a.1));
    dirs_list.truncate(limit);

    let mut sessions: Vec<ConversationSession> = vec![];

    for (id, last_updated) in dirs_list {
        let transcript_path = brain_dir.join(&id).join(".system_generated").join("logs").join("transcript.jsonl");
        if !transcript_path.exists() {
            continue;
        }

        if let Some(session) = parse_transcript(&transcript_path, &id, last_updated) {
            sessions.push(session);
        }
    }

    sessions.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));
    let current_session = sessions.first().cloned();

    FetchAllStatsResponse {
        sessions,
        current_session,
        total_supported_models: 20,
        error: None,
    }
}

fn parse_transcript(path: &Path, id: &str, last_updated: u64) -> Option<ConversationSession> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut step_count: usize = 0;
    let mut user_message_count: usize = 0;
    let mut detected_model_key = "gemini-3.7-flash".to_string();
    let mut detected_model_name = "Gemini 3.7 Flash".to_string();
    let mut title = format!("Conversation {}", &id[..8.min(id.len())]);

    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(step) = serde_json::from_str::<RawStep>(&line) {
            step_count += 1;

            let is_user = step.step_type.as_deref() == Some("USER_INPUT")
                || step.source.as_deref() == Some("USER_EXPLICIT");
            let is_model = step.step_type.as_deref() == Some("PLANNER_RESPONSE")
                || step.source.as_deref() == Some("MODEL");

            if let Some(content) = step.content {
                // Check if content mentions model change
                if content.contains("Model Selection") {
                    let (key, name, _, _) = resolve_model_pricing(&content);
                    detected_model_key = key.to_string();
                    detected_model_name = name.to_string();
                }

                let tokens = count_tokens(&content);
                if is_user {
                    input_tokens += tokens;
                    user_message_count += 1;
                    if user_message_count == 1 {
                        let clean = content.trim();
                        if !clean.is_empty() {
                            title = if clean.len() > 38 {
                                format!("{}...", &clean[..35])
                            } else {
                                clean.to_string()
                            };
                        }
                    }
                } else if is_model {
                    output_tokens += tokens;
                } else {
                    input_tokens += tokens;
                }
            }

            if let Some(tool_calls) = step.tool_calls {
                for tc in tool_calls {
                    let str_repr = tc.to_string();
                    output_tokens += count_tokens(&str_repr);
                }
            }
        }
    }

    let (_, _, in_rate, out_rate) = resolve_model_pricing(&detected_model_key);
    let cost = ((input_tokens as f64 / 1_000_000.0) * in_rate)
        + ((output_tokens as f64 / 1_000_000.0) * out_rate);

    Some(ConversationSession {
        conversation_id: id.to_string(),
        title,
        last_updated,
        step_count,
        user_message_count,
        detected_model: Some(detected_model_key),
        detected_model_name: Some(detected_model_name),
        metrics: TokenMetrics {
            input_tokens,
            output_tokens,
            total_tokens: input_tokens + output_tokens,
            estimated_cost_usd: cost,
        },
    })
}
