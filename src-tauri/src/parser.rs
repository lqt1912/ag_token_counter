use crate::constants::{get_default_brain_dir, resolve_model_pricing};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

const TRANSCRIPT_PARSER_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenMetrics {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub estimated_cost_usd: f64,
    /// Raw transcript additions, retained so the estimate can be audited.
    pub transcript_input_tokens: u64,
    pub transcript_output_tokens: u64,
    /// Number of model requests used for the context replay estimate.
    pub estimated_request_count: usize,
    /// Context size at the end of this transcript, separate from cumulative
    /// processed/request tokens.
    pub latest_context_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageMetrics {
    pub model_key: String,
    pub model_name: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub estimated_cost_usd: f64,
    pub step_count: usize,
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
    pub model_breakdown: Option<HashMap<String, ModelUsageMetrics>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextLimit {
    pub limit: u64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchAllStatsResponse {
    pub sessions: Vec<ConversationSession>,
    pub current_session: Option<ConversationSession>,
    pub total_supported_models: usize,
    pub context_limits: Option<HashMap<String, ContextLimit>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedSession {
    pub mtime: u64,
    #[serde(default)]
    pub parser_version: u32,
    pub session: ConversationSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataStorePayload {
    pub version: u32,
    pub last_saved: u64,
    pub sessions: HashMap<String, CachedSession>,
}

pub fn get_data_store_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let exe_str = exe.to_string_lossy();
        // In Dev mode (running inside target\debug): save to project_root/data/
        if exe_str.contains("target\\debug") || exe_str.contains("target/debug") {
            if let Ok(cwd) = std::env::current_dir() {
                let project_data = if cwd.ends_with("src-tauri") {
                    cwd.parent().unwrap_or(&cwd).join("data")
                } else {
                    cwd.join("data")
                };
                if std::fs::create_dir_all(&project_data).is_ok() {
                    return project_data.join("data-store.json");
                }
            }
        } else if let Some(parent) = exe.parent() {
            // In Portable Production mode: ALWAYS inside "data/" next to the .exe
            let portable_data = parent.join("data");
            if std::fs::create_dir_all(&portable_data).is_ok() {
                return portable_data.join("data-store.json");
            }
        }
    }

    // Priority 2: Next to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let portable_data = parent.join("data");
            if std::fs::create_dir_all(&portable_data).is_ok() {
                return portable_data.join("data-store.json");
            }
        }
    }

    // Fallback if directory is read-only (e.g. C:\Program Files): %APPDATA%\AI-Token-Analytics\data
    let fallback = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI-Token-Analytics")
        .join("data");
    let _ = std::fs::create_dir_all(&fallback);
    fallback.join("data-store.json")
}

pub fn load_cache_from_disk() -> HashMap<String, CachedSession> {
    let store_path = get_data_store_path();
    if store_path.exists() {
        if let Ok(file) = File::open(&store_path) {
            let reader = BufReader::new(file);
            if let Ok(payload) = serde_json::from_reader::<_, DataStorePayload>(reader) {
                return payload.sessions;
            }
        }
    }
    HashMap::new()
}

pub fn save_cache_to_disk(sessions: &HashMap<String, CachedSession>) {
    let store_path = get_data_store_path();
    if let Some(parent) = store_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let payload = DataStorePayload {
        version: TRANSCRIPT_PARSER_VERSION,
        last_saved: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        sessions: sessions.clone(),
    };

    let tmp_path = store_path.with_extension("tmp");
    if let Ok(file) = File::create(&tmp_path) {
        let writer = std::io::BufWriter::new(file);
        if serde_json::to_writer(writer, &payload).is_ok() {
            let _ = std::fs::rename(tmp_path, store_path);
        }
    }
}

static SESSION_CACHE: LazyLock<Mutex<HashMap<String, CachedSession>>> =
    LazyLock::new(|| Mutex::new(load_cache_from_disk()));

#[derive(Deserialize)]
struct RawStep {
    #[serde(rename = "type")]
    step_type: Option<String>,
    source: Option<String>,
    content: Option<String>,
    thinking: Option<String>,
    tool_calls: Option<Vec<serde_json::Value>>,
    model: Option<String>,
    model_name: Option<String>,
    metadata: Option<serde_json::Value>,
}

fn count_tokens(text: &str) -> u64 {
    if text.is_empty() {
        return 0;
    }

    // Antigravity transcripts do not expose provider-reported token usage and
    // Gemini/Claude tokenizers are not bundled in this portable app. Keep this
    // intentionally labelled as an estimate, while handling non-ASCII text
    // substantially better than a flat chars/3.85 ratio.
    let mut ascii_chars = 0_u64;
    let mut non_ascii_chars = 0_u64;
    for character in text.chars() {
        if character.is_ascii() {
            ascii_chars += 1;
        } else {
            non_ascii_chars += 1;
        }
    }
    let word_count = text.split_whitespace().count() as u64;
    let estimated =
        (ascii_chars as f64 / 3.8).ceil() as u64 + (non_ascii_chars as f64 / 2.0).ceil() as u64;
    estimated.max(word_count)
}

fn is_tool_result_type(step_type: Option<&str>) -> bool {
    matches!(
        step_type,
        Some("VIEW_FILE")
            | Some("GREP_SEARCH")
            | Some("RUN_COMMAND")
            | Some("CODE_ACTION")
            | Some("LIST_DIRECTORY")
            | Some("SEARCH_WEB")
            | Some("BROWSER_SUBAGENT")
            | Some("GENERATE_IMAGE")
            | Some("READ_URL_CONTENT")
    )
}

fn extract_model_from_step(step: &RawStep, is_user: bool) -> Option<String> {
    if let Some(model) = step
        .model
        .as_deref()
        .filter(|model| !model.trim().is_empty())
    {
        return Some(model.trim().to_string());
    }
    if let Some(model) = step
        .model_name
        .as_deref()
        .filter(|model| !model.trim().is_empty())
    {
        return Some(model.trim().to_string());
    }
    if let Some(metadata) = step
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.as_object())
    {
        for key in ["model", "model_name"] {
            if let Some(model) = metadata
                .get(key)
                .and_then(|value| value.as_str())
                .filter(|model| !model.trim().is_empty())
            {
                return Some(model.trim().to_string());
            }
        }
    }

    if !is_user {
        return None;
    }
    let content = step.content.as_deref()?;
    let settings_block =
        Regex::new(r"(?is)<USER_SETTINGS_CHANGE>(.*?)</USER_SETTINGS_CHANGE>").ok()?;
    let target = settings_block
        .captures(content)
        .and_then(|captures| captures.get(1).map(|capture| capture.as_str()))
        .unwrap_or(content);
    let selection = Regex::new(r"(?i)Model\s+Selection.*?\bto\s+([A-Za-z0-9\s\-\.\(\)]+?)(?:\.\s+No need|\.\s*$|\.\s*\n|\.\s*<|\r|\n|<|$)").ok()?;
    if let Some(model) = selection
        .captures(target)
        .and_then(|captures| {
            captures.get(1).map(|capture| {
                capture
                    .as_str()
                    .trim()
                    .trim_matches(|character| matches!(character, '`' | '\"' | '\''))
            })
        })
        .filter(|model| !model.is_empty() && !model.eq_ignore_ascii_case("none"))
    {
        return Some(model.to_string());
    }

    let tag = Regex::new(r"(?is)<(?:model_selection|model_name|model)>([^<]+)</").ok()?;
    tag.captures(content)
        .and_then(|captures| {
            captures
                .get(1)
                .map(|capture| capture.as_str().trim().to_string())
        })
        .filter(|model| !model.is_empty())
}

pub fn get_context_limits() -> HashMap<String, ContextLimit> {
    let mut map = HashMap::new();
    map.insert(
        "gemini-3.8-flash".into(),
        ContextLimit {
            limit: 1_000_000,
            label: "1M Context".into(),
        },
    );
    map.insert(
        "gemini-3.8-flash-cyber".into(),
        ContextLimit {
            limit: 1_000_000,
            label: "1M Context".into(),
        },
    );
    map.insert(
        "gemini-3.7-flash".into(),
        ContextLimit {
            limit: 1_000_000,
            label: "1M Context".into(),
        },
    );
    map.insert(
        "gemini-3.6-flash".into(),
        ContextLimit {
            limit: 1_000_000,
            label: "1M Context".into(),
        },
    );
    map.insert(
        "gemini-3.5-flash".into(),
        ContextLimit {
            limit: 1_000_000,
            label: "1M Context".into(),
        },
    );
    map.insert(
        "gemini-3.1-pro".into(),
        ContextLimit {
            limit: 1_000_000,
            label: "1M Context".into(),
        },
    );
    map.insert(
        "claude-sonnet-4-6".into(),
        ContextLimit {
            limit: 200_000,
            label: "200K Context".into(),
        },
    );
    map.insert(
        "claude-opus-4-6".into(),
        ContextLimit {
            limit: 200_000,
            label: "200K Context".into(),
        },
    );
    map.insert(
        "claude-3-7-sonnet".into(),
        ContextLimit {
            limit: 200_000,
            label: "200K Context".into(),
        },
    );
    map.insert(
        "claude-3-5-sonnet".into(),
        ContextLimit {
            limit: 200_000,
            label: "200K Context".into(),
        },
    );
    map.insert(
        "claude-3-5-haiku".into(),
        ContextLimit {
            limit: 200_000,
            label: "200K Context".into(),
        },
    );
    map.insert(
        "claude-3-opus".into(),
        ContextLimit {
            limit: 200_000,
            label: "200K Context".into(),
        },
    );
    map.insert(
        "gpt-oss-120b".into(),
        ContextLimit {
            limit: 128_000,
            label: "128K Context".into(),
        },
    );
    map.insert(
        "gpt-4o".into(),
        ContextLimit {
            limit: 128_000,
            label: "128K Context".into(),
        },
    );
    map.insert(
        "gpt-4o-mini".into(),
        ContextLimit {
            limit: 128_000,
            label: "128K Context".into(),
        },
    );
    map.insert(
        "default".into(),
        ContextLimit {
            limit: 200_000,
            label: "200K Context".into(),
        },
    );
    map
}

pub fn parse_all_sessions(limit: usize) -> FetchAllStatsResponse {
    let brain_dir = match get_default_brain_dir() {
        Some(dir) if dir.exists() => dir,
        _ => {
            return FetchAllStatsResponse {
                sessions: vec![],
                current_session: None,
                total_supported_models: 20,
                context_limits: Some(get_context_limits()),
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
                        let mtime = entry
                            .metadata()
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
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
    let mut modified = false;

    for (id, dir_mtime) in &dirs_list {
        let transcript_path = brain_dir
            .join(id)
            .join(".system_generated")
            .join("logs")
            .join("transcript.jsonl");
        if !transcript_path.exists() {
            continue;
        }

        // Exact transcript file modified time
        let file_mtime = std::fs::metadata(&transcript_path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(*dir_mtime);

        // Reparse unchanged transcripts after a parser migration so persisted
        // totals never survive a token-accounting fix.
        let cached_hit = {
            let cache = SESSION_CACHE.lock().unwrap();
            cache
                .get(id)
                .filter(|c| c.mtime == file_mtime && c.parser_version == TRANSCRIPT_PARSER_VERSION)
                .map(|c| c.session.clone())
        };

        if let Some(session) = cached_hit {
            sessions.push(session);
            continue;
        }

        // Only parse when file is new or modified
        if let Some(session) = parse_transcript(&transcript_path, id, file_mtime) {
            let mut cache = SESSION_CACHE.lock().unwrap();
            cache.insert(
                id.clone(),
                CachedSession {
                    mtime: file_mtime,
                    parser_version: TRANSCRIPT_PARSER_VERSION,
                    session: session.clone(),
                },
            );
            sessions.push(session);
            modified = true;
        }
    }

    if modified {
        let cache = SESSION_CACHE.lock().unwrap();
        save_cache_to_disk(&cache);
    }

    sessions.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));
    let current_session = sessions.first().cloned();

    FetchAllStatsResponse {
        sessions,
        current_session,
        total_supported_models: 20,
        context_limits: Some(get_context_limits()),
        error: None,
    }
}

fn parse_transcript(path: &Path, id: &str, last_updated: u64) -> Option<ConversationSession> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut transcript_input_tokens: u64 = 0;
    let mut transcript_output_tokens: u64 = 0;
    let mut estimated_request_input_tokens: u64 = 0;
    let mut context_tokens: u64 = 0;
    let mut estimated_request_count: usize = 0;
    let mut step_count: usize = 0;
    let mut user_message_count: usize = 0;
    let mut detected_model_key = "gemini-3.7-flash".to_string();
    let mut detected_model_name = "Gemini 3.7 Flash".to_string();
    let mut title = format!("Conversation {}", &id[..8.min(id.len())]);
    let mut model_breakdown: HashMap<String, ModelUsageMetrics> = HashMap::new();

    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(step) = serde_json::from_str::<RawStep>(&line) else {
            continue;
        };
        step_count += 1;

        let is_user = step.step_type.as_deref() == Some("USER_INPUT")
            || step.source.as_deref() == Some("USER_EXPLICIT");
        let is_model = step.source.as_deref() == Some("MODEL");
        let is_tool_result = is_model && is_tool_result_type(step.step_type.as_deref());
        let is_model_output = is_model && !is_tool_result;

        if let Some(raw_model) = extract_model_from_step(&step, is_user) {
            let (key, name, _, _) = resolve_model_pricing(&raw_model);
            detected_model_key = key.to_string();
            detected_model_name = name.to_string();
        }

        let (model_key, model_name, _, _) = resolve_model_pricing(&detected_model_key);
        let mb = model_breakdown
            .entry(model_key.to_string())
            .or_insert_with(|| ModelUsageMetrics {
                model_key: model_key.to_string(),
                model_name: model_name.to_string(),
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
                estimated_cost_usd: 0.0,
                step_count: 0,
            });
        mb.step_count += 1;

        let mut step_input_tokens = 0_u64;
        let mut step_output_tokens = 0_u64;

        if let Some(content) = step.content.as_deref() {
            let tokens = count_tokens(content);
            if is_user {
                step_input_tokens += tokens;
                user_message_count += 1;

                if user_message_count == 1 {
                    let raw_text = if let Some(start) = content.find("<USER_REQUEST>") {
                        let sub = &content[start + "<USER_REQUEST>".len()..];
                        sub.find("</USER_REQUEST>")
                            .map(|end| &sub[..end])
                            .unwrap_or(sub)
                    } else {
                        content
                    };
                    let clean_title = raw_text.split_whitespace().collect::<Vec<_>>().join(" ");
                    if !clean_title.is_empty() {
                        title = if clean_title.chars().count() > 38 {
                            format!("{}...", clean_title.chars().take(35).collect::<String>())
                        } else {
                            clean_title
                        };
                    }
                }
            } else if is_model_output {
                step_output_tokens += tokens;
            } else {
                // Tool responses are logged with source MODEL, but their content
                // is context supplied to a later model invocation.
                step_input_tokens += tokens;
            }
        }

        if is_model {
            if let Some(thinking) = step.thinking.as_deref() {
                let tokens = count_tokens(thinking);
                step_output_tokens += tokens;
            }
            if let Some(tool_calls) = step.tool_calls.as_ref() {
                for tool_call in tool_calls {
                    // Count the complete serialized tool-call payload, including
                    // field names and JSON punctuation.
                    let tokens = count_tokens(&tool_call.to_string());
                    step_output_tokens += tokens;
                }
            }
        }

        transcript_input_tokens += step_input_tokens;
        transcript_output_tokens += step_output_tokens;

        // Replay the context accumulated before each model invocation. This is
        // much closer to what a usage meter counts than counting each log entry
        // only once, while remaining explicit that it is an estimate.
        if step.step_type.as_deref() == Some("PLANNER_RESPONSE") {
            estimated_request_input_tokens += context_tokens;
            mb.input_tokens += context_tokens;
            estimated_request_count += 1;
        }
        mb.output_tokens += step_output_tokens;
        mb.total_tokens = mb.input_tokens + mb.output_tokens;

        if matches!(
            step.step_type.as_deref(),
            Some("CHECKPOINT") | Some("CONVERSATION_HISTORY")
        ) {
            context_tokens = step_input_tokens + step_output_tokens;
        } else {
            context_tokens += step_input_tokens + step_output_tokens;
        }
    }

    let mut cost = 0.0;
    for metric in model_breakdown.values_mut() {
        let (_, _, in_rate, out_rate) = resolve_model_pricing(&metric.model_key);
        metric.estimated_cost_usd = ((metric.input_tokens as f64 / 1_000_000.0) * in_rate)
            + ((metric.output_tokens as f64 / 1_000_000.0) * out_rate);
        cost += metric.estimated_cost_usd;
    }

    Some(ConversationSession {
        conversation_id: id.to_string(),
        title,
        last_updated,
        step_count,
        user_message_count,
        detected_model: Some(detected_model_key),
        detected_model_name: Some(detected_model_name),
        metrics: TokenMetrics {
            input_tokens: estimated_request_input_tokens,
            output_tokens: transcript_output_tokens,
            total_tokens: estimated_request_input_tokens + transcript_output_tokens,
            estimated_cost_usd: cost,
            transcript_input_tokens,
            transcript_output_tokens,
            estimated_request_count,
            latest_context_tokens: context_tokens,
        },
        model_breakdown: Some(model_breakdown),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_tool_results_and_thinking_for_the_selected_model() {
        let temp_dir = std::env::temp_dir().join(format!(
            "ag-token-counter-test-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let transcript = temp_dir.join("transcript.jsonl");

        let settings_and_prompt = "<USER_SETTINGS_CHANGE> The user changed setting Model Selection from None to Gemini 2.0 Flash. </USER_SETTINGS_CHANGE>\nSummarize this file.";
        let tool_result = "line one from the inspected file\nline two from the inspected file";
        let thinking = "I need to inspect the result before answering.";
        let tool_call = serde_json::json!({"name":"view_file","args":{"path":"src/app.ts"}});
        let final_answer = "The file contains two lines.";
        let lines = vec![
            serde_json::json!({"source":"USER_EXPLICIT","type":"USER_INPUT","content":settings_and_prompt}),
            serde_json::json!({"source":"MODEL","type":"PLANNER_RESPONSE","thinking":thinking,"tool_calls":[tool_call.clone()]}),
            serde_json::json!({"source":"MODEL","type":"VIEW_FILE","content":tool_result}),
            serde_json::json!({"source":"MODEL","type":"PLANNER_RESPONSE","content":final_answer}),
        ];
        std::fs::write(
            &transcript,
            lines
                .into_iter()
                .map(|line| line.to_string())
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();

        let session = parse_transcript(&transcript, "test-conversation", 1).unwrap();
        let first_context = count_tokens(settings_and_prompt);
        let first_output = count_tokens(thinking) + count_tokens(&tool_call.to_string());
        let second_context = first_context + first_output + count_tokens(tool_result);
        let expected_input = first_context + second_context;
        let expected_output = count_tokens(thinking)
            + count_tokens(&tool_call.to_string())
            + count_tokens(final_answer);

        assert_eq!(session.detected_model.as_deref(), Some("gemini-2.0-flash"));
        assert_eq!(session.metrics.input_tokens, expected_input);
        assert_eq!(session.metrics.output_tokens, expected_output);
        assert_eq!(
            session.metrics.total_tokens,
            expected_input + expected_output
        );
        assert_eq!(
            session.metrics.transcript_input_tokens,
            first_context + count_tokens(tool_result)
        );
        assert_eq!(session.metrics.estimated_request_count, 2);
        assert_eq!(resolve_model_pricing("Gemini 1.5 Pro").0, "gemini-1.5-pro");

        std::fs::remove_dir_all(temp_dir).unwrap();
    }
}
