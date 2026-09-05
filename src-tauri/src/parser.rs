use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::{LazyLock, Mutex};
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
        version: 1,
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
    tool_calls: Option<Vec<serde_json::Value>>,
}

fn count_tokens(text: &str) -> u64 {
    if text.is_empty() {
        return 0;
    }
    let chars = text.chars().count();
    ((chars as f64) / 3.85).ceil() as u64
}

pub fn get_context_limits() -> HashMap<String, ContextLimit> {
    let mut map = HashMap::new();
    map.insert("gemini-3.8-flash".into(), ContextLimit { limit: 1_000_000, label: "1M Context".into() });
    map.insert("gemini-3.8-flash-cyber".into(), ContextLimit { limit: 1_000_000, label: "1M Context".into() });
    map.insert("gemini-3.7-flash".into(), ContextLimit { limit: 1_000_000, label: "1M Context".into() });
    map.insert("gemini-3.6-flash".into(), ContextLimit { limit: 1_000_000, label: "1M Context".into() });
    map.insert("gemini-3.5-flash".into(), ContextLimit { limit: 1_000_000, label: "1M Context".into() });
    map.insert("gemini-3.1-pro".into(), ContextLimit { limit: 1_000_000, label: "1M Context".into() });
    map.insert("claude-sonnet-4-6".into(), ContextLimit { limit: 200_000, label: "200K Context".into() });
    map.insert("claude-opus-4-6".into(), ContextLimit { limit: 200_000, label: "200K Context".into() });
    map.insert("claude-3-7-sonnet".into(), ContextLimit { limit: 200_000, label: "200K Context".into() });
    map.insert("claude-3-5-sonnet".into(), ContextLimit { limit: 200_000, label: "200K Context".into() });
    map.insert("claude-3-5-haiku".into(), ContextLimit { limit: 200_000, label: "200K Context".into() });
    map.insert("claude-3-opus".into(), ContextLimit { limit: 200_000, label: "200K Context".into() });
    map.insert("gpt-oss-120b".into(), ContextLimit { limit: 128_000, label: "128K Context".into() });
    map.insert("gpt-4o".into(), ContextLimit { limit: 128_000, label: "128K Context".into() });
    map.insert("gpt-4o-mini".into(), ContextLimit { limit: 128_000, label: "128K Context".into() });
    map.insert("default".into(), ContextLimit { limit: 200_000, label: "200K Context".into() });
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
                        let mtime = entry.metadata()
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
        let transcript_path = brain_dir.join(id).join(".system_generated").join("logs").join("transcript.jsonl");
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

        // Fast In-Memory Cache Check: Return instantly if file mtime hasn't changed
        let cached_hit = {
            let cache = SESSION_CACHE.lock().unwrap();
            cache.get(id).filter(|c| c.mtime == file_mtime).map(|c| c.session.clone())
        };

        if let Some(session) = cached_hit {
            sessions.push(session);
            continue;
        }

        // Only parse when file is new or modified
        if let Some(session) = parse_transcript(&transcript_path, id, file_mtime) {
            let mut cache = SESSION_CACHE.lock().unwrap();
            cache.insert(id.clone(), CachedSession {
                mtime: file_mtime,
                session: session.clone(),
            });
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

    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
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
                let (m_key, m_name, in_rate, out_rate) = resolve_model_pricing(&detected_model_key);
                let mb = model_breakdown.entry(m_key.to_string()).or_insert_with(|| ModelUsageMetrics {
                    model_key: m_key.to_string(),
                    model_name: m_name.to_string(),
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                    estimated_cost_usd: 0.0,
                    step_count: 0,
                });

                if is_user {
                    input_tokens += tokens;
                    user_message_count += 1;
                    mb.input_tokens += tokens;
                    mb.step_count += 1;

                    if user_message_count == 1 {
                        let raw_text = if let Some(start) = content.find("<USER_REQUEST>") {
                            let sub = &content[start + "<USER_REQUEST>".len()..];
                            if let Some(end) = sub.find("</USER_REQUEST>") {
                                &sub[..end]
                            } else {
                                sub
                            }
                        } else {
                            &content
                        };
                        let clean_title = raw_text.split_whitespace().collect::<Vec<_>>().join(" ");
                        if !clean_title.is_empty() {
                            let char_count = clean_title.chars().count();
                            title = if char_count > 38 {
                                let truncated: String = clean_title.chars().take(35).collect();
                                format!("{}...", truncated)
                            } else {
                                clean_title
                            };
                        }
                    }
                } else if is_model {
                    output_tokens += tokens;
                    mb.output_tokens += tokens;
                } else {
                    input_tokens += tokens;
                    mb.input_tokens += tokens;
                }

                mb.total_tokens = mb.input_tokens + mb.output_tokens;
                mb.estimated_cost_usd = ((mb.input_tokens as f64 / 1_000_000.0) * in_rate)
                    + ((mb.output_tokens as f64 / 1_000_000.0) * out_rate);
            }

            if let Some(tool_calls) = step.tool_calls {
                for tc in tool_calls {
                    let str_repr = tc.to_string();
                    let tc_tokens = count_tokens(&str_repr);
                    output_tokens += tc_tokens;

                    let (m_key, m_name, in_rate, out_rate) = resolve_model_pricing(&detected_model_key);
                    let mb = model_breakdown.entry(m_key.to_string()).or_insert_with(|| ModelUsageMetrics {
                        model_key: m_key.to_string(),
                        model_name: m_name.to_string(),
                        input_tokens: 0,
                        output_tokens: 0,
                        total_tokens: 0,
                        estimated_cost_usd: 0.0,
                        step_count: 0,
                    });
                    mb.output_tokens += tc_tokens;
                    mb.total_tokens = mb.input_tokens + mb.output_tokens;
                    mb.estimated_cost_usd = ((mb.input_tokens as f64 / 1_000_000.0) * in_rate)
                        + ((mb.output_tokens as f64 / 1_000_000.0) * out_rate);
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
        model_breakdown: Some(model_breakdown),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sessions() {
        let resp = parse_all_sessions(10);
        println!("Sessions found: {}", resp.sessions.len());
        if let Some(first) = resp.sessions.first() {
            println!("First session: {} (title: {}, tokens: {})", first.conversation_id, first.title, first.metrics.total_tokens);
        }
        assert!(resp.sessions.len() > 0, "Should find at least 1 session in brain dir");
    }
}

