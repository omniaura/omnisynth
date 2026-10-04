pub mod ollama;
pub mod openrouter;

pub fn get_system_prompt(agent_type: &str, previous_code: Option<&str>) -> String {
    let base_prompt = match agent_type {
        "strudel" => include_str!("../prompts/strudel_agent.txt"),
        "hydra" => include_str!("../prompts/hydra_agent.txt"),
        _ => "You are a code generation assistant.",
    };

    let mut prompt = base_prompt.to_string();

    if let Some(code) = previous_code {
        prompt.push_str("\n\n## Previous Code\nHere is the current code that you should build upon or modify:\n```\n");
        prompt.push_str(code);
        prompt.push_str("\n```\n");
    }

    prompt
}

