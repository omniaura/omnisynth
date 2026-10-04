mod ai;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateResult {
    pub strudel_code: Option<String>,
    pub hydra_code: Option<String>,
    pub strudel_error: Option<String>,
    pub hydra_error: Option<String>,
}

#[tauri::command]
async fn generate_code(
    provider: String,
    model: String,
    prompt: String,
    agent_type: String,
    previous_code: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    match provider.as_str() {
        "ollama" => {
            ai::ollama::generate_code(&model, &prompt, &agent_type, previous_code.as_deref()).await
        }
        "openrouter" => {
            let key = api_key.ok_or("API key required for OpenRouter")?;
            ai::openrouter::generate_code(&key, &model, &prompt, &agent_type, previous_code.as_deref()).await
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
async fn generate_both(
    provider: String,
    model: String,
    prompt: String,
    strudel_code: Option<String>,
    hydra_code: Option<String>,
    api_key: Option<String>,
) -> Result<GenerateResult, String> {
    // Run both agents in parallel
    let strudel_future = generate_code(
        provider.clone(),
        model.clone(),
        prompt.clone(),
        "strudel".to_string(),
        strudel_code,
        api_key.clone(),
    );

    let hydra_future = generate_code(
        provider,
        model,
        prompt,
        "hydra".to_string(),
        hydra_code,
        api_key,
    );

    let (strudel_result, hydra_result) = tokio::join!(strudel_future, hydra_future);

    Ok(GenerateResult {
        strudel_code: strudel_result.clone().ok(),
        hydra_code: hydra_result.clone().ok(),
        strudel_error: strudel_result.err(),
        hydra_error: hydra_result.err(),
    })
}

#[tauri::command]
async fn list_ollama_models() -> Result<Vec<String>, String> {
    ai::ollama::list_models().await
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            generate_code,
            generate_both,
            list_ollama_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
