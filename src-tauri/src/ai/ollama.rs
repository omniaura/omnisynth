use ollama_rs::generation::completion::request::GenerationRequest;
use ollama_rs::Ollama;

use super::get_system_prompt;

pub async fn generate_code(
    model: &str,
    prompt: &str,
    agent_type: &str,
    previous_code: Option<&str>,
) -> Result<String, String> {
    let ollama = Ollama::default();

    let system_prompt = get_system_prompt(agent_type, previous_code);

    let full_prompt = format!(
        "{}\n\n## User Request\n{}\n\n## Response\nProvide ONLY the code, no explanations:",
        system_prompt, prompt
    );

    let request = GenerationRequest::new(model.to_string(), full_prompt);

    match ollama.generate(request).await {
        Ok(response) => {
            // Extract code from response, removing markdown code blocks if present
            let code = extract_code_from_response(&response.response);
            Ok(code)
        }
        Err(e) => Err(format!("Ollama error: {}", e)),
    }
}

pub async fn list_models() -> Result<Vec<String>, String> {
    let ollama = Ollama::default();

    match ollama.list_local_models().await {
        Ok(models) => Ok(models.into_iter().map(|m| m.name).collect()),
        Err(e) => Err(format!("Failed to list Ollama models: {}", e)),
    }
}

fn extract_code_from_response(response: &str) -> String {
    let trimmed = response.trim();

    // Check if response is wrapped in markdown code blocks
    if trimmed.starts_with("```") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() >= 2 {
            // Find the closing ```
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

