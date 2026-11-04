use crate::engine::{Change, Controller, Pattern};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

struct Request {
    stream: TcpStream,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}
fn receive(mut stream: TcpStream) -> Result<Request, (TcpStream, u16)> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut bytes = Vec::with_capacity(1024);
    let end = loop {
        if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if bytes.len() >= 8192 {
            return Err((stream, 413));
        }
        if Instant::now() > deadline {
            return Err((stream, 408));
        }
        let mut chunk = [0; 1024];
        match stream.read(&mut chunk) {
            Ok(0) => return Err((stream, 400)),
            Ok(n) => bytes.extend_from_slice(&chunk[..n]),
            Err(_) => return Err((stream, 408)),
        }
    };
    let Ok(head) = std::str::from_utf8(&bytes[..end]) else {
        return Err((stream, 400));
    };
    let mut lines = head.split("\r\n");
    let first: Vec<_> = lines.next().unwrap_or("").split_whitespace().collect();
    if first.len() != 3 || first[2] != "HTTP/1.1" {
        return Err((stream, 400));
    }
    let method = first[0].to_string();
    let path = first[1].to_string();
    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let Some((key, value)) = line.split_once(':') else {
            return Err((stream, 400));
        };
        if headers
            .insert(key.to_ascii_lowercase(), value.trim().to_string())
            .is_some()
        {
            return Err((stream, 400));
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err((stream, 400));
    }
    let length = match headers.get("content-length") {
        Some(value) => match value.parse::<usize>() {
            Ok(n) if n <= 8192 => n,
            _ => return Err((stream, 413)),
        },
        None if method == "GET" => 0,
        None => return Err((stream, 411)),
    };
    while bytes.len() < end + length {
        if Instant::now() > deadline {
            return Err((stream, 408));
        }
        let mut chunk = [0; 1024];
        let remaining = (end + length - bytes.len()).min(chunk.len());
        match stream.read(&mut chunk[..remaining]) {
            Ok(0) => return Err((stream, 400)),
            Ok(n) => bytes.extend_from_slice(&chunk[..n]),
            Err(_) => return Err((stream, 408)),
        }
    }
    Ok(Request {
        stream,
        method,
        path,
        headers,
        body: bytes[end..end + length].to_vec(),
    })
}

pub const APP_ID: &str = "com.omniaura.omnisynth.bevy-slice";
pub struct Bridge {
    pub path: PathBuf,
    token: String,
    stopping: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

pub fn data_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support/OmniSynth Bevy Slice")
    } else if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("OmniSynth Bevy Slice")
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"))
            .join("omnisynth-bevy-slice")
    }
}

fn header(request: &Request, name: &str) -> Option<String> {
    request.headers.get(&name.to_ascii_lowercase()).cloned()
}
fn reply(request: Request, status: u16, body: Value) {
    respond(request.stream, status, body);
}
fn respond(mut stream: TcpStream, status: u16, body: Value) {
    let body = if status == 202 {
        String::new()
    } else {
        body.to_string()
    };
    let response = format!(
        "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn catalog() -> Value {
    json!([
        {"name":"set_pattern","description":"Replace the native 16-step MIDI pattern. Returns an accepted revision; poll get_state.applied_revision for audio-thread application.","inputSchema":{"type":"object","additionalProperties":false,"required":["notes","bpm","gain","waveform"],"properties":{"notes":{"type":"array","minItems":16,"maxItems":16,"items":{"anyOf":[{"type":"integer","minimum":24,"maximum":96},{"type":"null"}]}},"bpm":{"type":"number","minimum":40,"maximum":240},"gain":{"type":"number","minimum":0,"maximum":0.25},"waveform":{"enum":["sine","triangle"]}}}},
        {"name":"set_transport","description":"Start from step 1 or stop the native synth.","inputSchema":{"type":"object","additionalProperties":false,"required":["playing"],"properties":{"playing":{"type":"boolean"}}}},
        {"name":"get_state","description":"Read the sample-clock transport and measured output energy.","inputSchema":{"type":"object","additionalProperties":false}}
    ])
}
fn call(control: &Controller, name: &str, args: Value) -> Result<Value, String> {
    match name {
        "set_pattern" => {
            let pattern: Pattern = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let revision = control.send(Change::Pattern(pattern))?;
            Ok(json!({"accepted_revision":revision}))
        }
        "set_transport" => {
            #[derive(serde::Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Transport {
                playing: bool,
            }
            let args: Transport = serde_json::from_value(args).map_err(|e| e.to_string())?;
            Ok(json!({"accepted_revision":control.send(Change::Transport(args.playing))?}))
        }
        "get_state" if args.as_object().is_some_and(|v| v.is_empty()) => {
            Ok(serde_json::to_value(control.meter.snapshot()).unwrap())
        }
        "get_state" => Err("get_state takes an empty object".into()),
        _ => Err("Unknown tool".into()),
    }
}
fn handle(request: Request, token: &str, port: u16, control: &Controller) {
    let host = header(&request, "Host").unwrap_or_default();
    if header(&request, "Origin").is_some()
        || ![format!("127.0.0.1:{port}"), format!("localhost:{port}")].contains(&host)
    {
        reply(
            request,
            403,
            json!({"error":"Browser origins and non-loopback hosts are not accepted"}),
        );
        return;
    }
    if header(&request, "Authorization").as_deref() != Some(&format!("Bearer {token}")) {
        reply(request, 401, json!({"error":"Authentication required"}));
        return;
    }
    if request.method == "GET" && request.path == "/state" {
        reply(
            request,
            200,
            serde_json::to_value(control.meter.snapshot()).unwrap(),
        );
        return;
    }
    if request.method != "POST" || request.path != "/mcp" {
        reply(request, 404, json!({"error":"Not found"}));
        return;
    }
    let Ok(rpc) = serde_json::from_slice::<Value>(&request.body) else {
        reply(request, 400, json!({"error":"Invalid JSON"}));
        return;
    };
    let id = rpc.get("id").cloned().unwrap_or(Value::Null);
    let method = rpc.get("method").and_then(Value::as_str).unwrap_or("");
    if rpc.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        reply(request, 400, json!({"error":"JSON-RPC 2.0 required"}));
        return;
    }
    if method == "notifications/initialized" {
        reply(request, 202, json!({}));
        return;
    }
    let result = match method {
        "initialize" => {
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"omnisynth-bevy-slice","version":env!("CARGO_PKG_VERSION")}})
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools":catalog()}),
        "tools/call" => {
            let name = rpc
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            match call(
                control,
                name,
                rpc.pointer("/params/arguments")
                    .cloned()
                    .unwrap_or(json!({})),
            ) {
                Ok(value) => {
                    json!({"content":[{"type":"text","text":value.to_string()}],"isError":false})
                }
                Err(error) => json!({"content":[{"type":"text","text":error}],"isError":true}),
            }
        }
        _ => {
            reply(
                request,
                200,
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
            );
            return;
        }
    };
    reply(
        request,
        200,
        json!({"jsonrpc":"2.0","id":id,"result":result}),
    );
}

impl Bridge {
    pub fn start(control: Controller, directory: &Path) -> Result<Self, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let mut bytes = [0_u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let path = directory.join("bridge.json");
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path).map_err(|e| format!("Cannot claim {}: {e}. Another slice may be running; inspect a stale file before removing it.", path.display()))?;
        let discovery = json!({"app_id":APP_ID,"version":env!("CARGO_PKG_VERSION"),"pid":std::process::id(),"port":port,"token":token,"url":format!("http://127.0.0.1:{port}/mcp")});
        file.write_all(discovery.to_string().as_bytes())
            .map_err(|e| e.to_string())?;
        let stopping = Arc::new(AtomicBool::new(false));
        let stop = stopping.clone();
        let auth = token.clone();
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => match receive(stream) {
                        Ok(request) => handle(request, &auth, port, &control),
                        Err((stream, status)) => respond(
                            stream,
                            status,
                            json!({"error":"Invalid or timed out HTTP request"}),
                        ),
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            path,
            token,
            stopping,
            thread: Some(thread),
        })
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        // Every request has a bounded read deadline and write timeout.
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        if fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.get("token").cloned())
            == Some(json!(self.token))
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oversized_bodies_and_stalled_headers_are_bounded() {
        for (wire, expected) in [
            (
                "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: 9999\r\n\r\n",
                413,
            ),
            ("GET /state HTTP/1.1\r\n", 408),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let addr = listener.local_addr().unwrap();
            let worker = thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                match receive(stream) {
                    Err((_, status)) => status,
                    Ok(_) => 0,
                }
            });
            let mut client = TcpStream::connect(addr).unwrap();
            client.write_all(wire.as_bytes()).unwrap();
            let started = Instant::now();
            assert_eq!(worker.join().unwrap(), expected);
            assert!(started.elapsed() < Duration::from_secs(3));
        }
    }
}
