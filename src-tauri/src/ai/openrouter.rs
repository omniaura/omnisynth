use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::get_system_prompt;

const OPENROUTER_API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct Message {
    content: String,
}

pub async fn generate_code(
    api_key: &str,
    model: &str,
    prompt: &str,
    agent_type: &str,
    previous_code: Option<&str>,
) -> Result<String, String> {
    let client = Client::new();

    let system_prompt = get_system_prompt(agent_type, previous_code);

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!(
                "{}\n\nProvide ONLY the code, no explanations or markdown formatting.",
                prompt
            ),
        },
    ];

    let request = ChatCompletionRequest {
        model: model.to_string(),
        messages,
        temperature: 0.7,
        max_tokens: 2048,
    };

    let response = client
        .post(OPENROUTER_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://aurajam.app")
        .header("X-Title", "AuraJam")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenRouter API error: {}", error_text));
    }

    let completion: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(choice) = completion.choices.first() {
        let code = extract_code_from_response(&choice.message.content);
        Ok(code)
    } else {
        Err("No response from OpenRouter".to_string())
    }
}

fn extract_code_from_response(response: &str) -> String {
    let trimmed = response.trim();

    // Check if response is wrapped in markdown code blocks
    if trimmed.starts_with("```") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() >= 2 {
            let start = 1;
            let mut end = lines.len();
            for (i, line) in lines.iter().enumerate().rev() {
                if line.trim() == "```" {
                    end = i;
                    break;
                }
            }
            return lines[start..end].join("\n");
        }
    }

    trimmed.to_string()
}

