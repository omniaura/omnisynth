#!/usr/bin/env python3
"""Native-window + CPAL/PulseAudio + authenticated MCP vertical-slice QA.

Only starts/stops this script's own processes. No real accounts or paid inference.
Run on an isolated Linux builder with Xvfb, PulseAudio, xdotool and ffmpeg.
"""
import argparse
import json
import math
import os
from pathlib import Path
import select
import signal
import struct
import subprocess
import time
import urllib.error
import urllib.request
import wave

parser = argparse.ArgumentParser()
parser.add_argument("binary", type=Path)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
binary = args.binary.resolve()
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=False)
processes = []
logs = []

def start(command, env=None, stdout=None):
    log = open(out / f"process-{len(processes)}.log", "w")
    logs.append(log)
    process = subprocess.Popen(command, cwd=out, env=env, stdout=stdout or log, stderr=log)
    processes.append(process)
    return process

def wait_for(fn, timeout=30):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = fn()
            if result:
                return result
        except (OSError, ValueError, urllib.error.URLError) as error:
            last = error
        time.sleep(0.1)
    raise AssertionError(f"Timed out; last error: {last}")

def stop(process):
    if process not in processes:
        raise ValueError("Refusing to signal a process not started by this smoke run")
    if process.poll() is None:
        # Inspect each still-owned child before signalling it; never discover or
        # kill processes by name, port or a PID read from a discovery file.
        try:
            cwd = Path(f"/proc/{process.pid}/cwd").resolve(strict=True)
        except OSError:
            cwd = None
        print(f"inspected={process.pid} cwd={cwd} killed=0 spared=0 action=interrupt-owned-child")
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=12)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                print(f"inspected={process.pid} killed=1 spared=0 action=kill-owned-child-after-two-timeouts")
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass

try:
    display = start(["Xvfb", "-displayfd", "1", "-screen", "0", "1100x700x24", "-nolisten", "tcp"], stdout=subprocess.PIPE)
    assert select.select([display.stdout], [], [], 10)[0], "Xvfb did not allocate a display"
    display_number = display.stdout.readline().decode().strip()
    assert display_number.isdigit()
    pulse_socket = out / "pulse.sock"
    pulse = start(["pulseaudio", "-n", "--daemonize=no", "--use-pid-file=no", "--exit-idle-time=-1",
                   "-L", f"module-native-protocol-unix socket={pulse_socket} auth-anonymous=1",
                   "-L", "module-null-sink sink_name=omnisynth_slice rate=48000 channels=2"])
    wait_for(pulse_socket.exists)
    alsa = out / "alsa.conf"
    alsa.write_text(f'pcm.!default {{ type pulse server "unix:{pulse_socket}" }}\nctl.!default {{ type pulse server "unix:{pulse_socket}" }}\n')
    env = {**os.environ, "DISPLAY": f":{display_number}", "PULSE_SERVER": f"unix:{pulse_socket}", "ALSA_CONFIG_PATH": str(alsa), "WGPU_BACKEND": "vulkan", "LP_NUM_THREADS": "2"}
    # Force the software Vulkan device: no GPU availability assumption in CI.
    icd = Path("/usr/share/vulkan/icd.d/lvp_icd.json")
    if icd.exists():
        env["VK_ICD_FILENAMES"] = str(icd)
    profile = out / "profile"
    app = start([str(binary), "--data-dir", str(profile), "--screenshot", str(out / "native.png")], env=env)
    discovery = wait_for(lambda: json.loads((profile / "bridge.json").read_text()))
    base = f'http://127.0.0.1:{discovery["port"]}'
    auth = {"Authorization": f'Bearer {discovery["token"]}'}

    def request(path, value=None, headers=None):
        body = None if value is None else json.dumps(value).encode()
        req = urllib.request.Request(base + path, data=body, headers=headers or {})
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def state():
        status, data = request("/state", headers=auth)
        assert status == 200
        return data

    def rpc(method, params=None):
        status, data = request("/mcp", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}, auth)
        assert status == 200, data
        return data["result"]

    def tool(name, arguments):
        result = rpc("tools/call", {"name": name, "arguments": arguments})
        assert result["isError"] is False, result
        return json.loads(result["content"][0]["text"])

    def applied(result):
        revision = result["accepted_revision"]
        return wait_for(lambda: (s if (s := state())["applied_revision"] >= revision else None))

    assert request("/state")[0] == 401
    assert request("/state", headers={**auth, "Origin": "https://example.invalid"})[0] == 403
    assert request("/state", headers={**auth, "Host": "example.invalid"})[0] == 403
    assert discovery["app_id"] == "com.omniaura.omnisynth.bevy-slice"
    initialized = rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "native-slice-qa", "version": "1"}})
    assert initialized["serverInfo"]["name"] == "omnisynth-bevy-slice"
    assert {t["name"] for t in rpc("tools/list")["tools"]} == {"set_pattern", "set_transport", "get_state"}
    invalid = rpc("tools/call", {"name": "set_pattern", "arguments": {"notes": [127]*16, "bpm": 120, "gain": 0.2, "waveform": "sine"}})
    assert invalid["isError"] is True
    wait_for(lambda: state()["frames"] > 1000)
    def visible_window():
        if app.poll() is not None:
            raise RuntimeError(f"Native app exited {app.returncode}; inspect process logs in {out}")
        return subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "OmniSynth Bevy Slice"], env=env, capture_output=True, text=True).stdout.strip()
    window_id = wait_for(visible_window, timeout=90).splitlines()[0]
    recording = start(["ffmpeg", "-y", "-loglevel", "warning", "-thread_queue_size", "512", "-f", "x11grab", "-framerate", "24", "-video_size", "1100x700", "-i", env["DISPLAY"], "-thread_queue_size", "512", "-f", "pulse", "-i", "omnisynth_slice.monitor",
                       "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out / "native.mp4"),
                       "-map", "1:a", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(out / "loopback.wav")], env=env)
    time.sleep(1)
    pattern = {"notes": [48,None,55,None,60,63,None,55,48,None,58,None,63,60,55,None], "bpm": 128, "gain": 0.2, "waveform": "sine"}
    applied(tool("set_pattern", pattern))
    start_state = applied(tool("set_transport", {"playing": True}))
    assert start_state["pattern"]["notes"] == pattern["notes"]
    assert start_state["pattern"]["bpm"] == pattern["bpm"]
    assert start_state["pattern"]["waveform"] == pattern["waveform"]
    assert abs(start_state["pattern"]["gain"] - pattern["gain"]) < 1e-6
    active = wait_for(lambda: (s if (s := state())["rms"] > 0.01 else None))
    subprocess.run(["xdotool", "windowfocus", "--sync", window_id], env=env, check=True)
    subprocess.run(["xdotool", "key", "--window", window_id, "w"], env=env, check=True)
    wait_for(lambda: state()["pattern"]["waveform"] == "triangle")
    subprocess.run(["xdotool", "mousemove", "--window", window_id, "186", "535", "click", "1"], env=env, check=True)
    wait_for(lambda: state()["pattern"]["notes"][1] == 48)
    time.sleep(4)
    stopped = applied(tool("set_transport", {"playing": False}))
    assert stopped["rms"] == 0 and stopped["playing"] is False
    assert stopped["audio_errors"] == 0, "Audio backend reported errors during QA"
    time.sleep(1)
    stop(recording)
    wait_for(lambda: (out / "native.png").exists(), timeout=30)
    with wave.open(str(out / "loopback.wav")) as audio:
        assert audio.getframerate() == 48000 and audio.getsampwidth() == 2
        data = audio.readframes(audio.getnframes())
    samples = [s[0]/32768 for s in struct.iter_unpack("<h", data)]
    rms = math.sqrt(sum(s*s for s in samples)/len(samples))
    peak = max(map(abs, samples))
    assert rms > 0.003, f"Recorded output was silent: rms={rms}"
    assert 0.02 < peak < 0.3, f"Recorded output was missing or clipping: peak={peak}"
    tail = samples[-int(0.3*48000):]
    assert max(map(abs, tail)) < 0.001, "Output did not become silent after stop"
    proof = {"app_id": discovery["app_id"], "mcp_client": initialized["serverInfo"], "checks": ["authentication", "origin and host rejection", "tool catalog", "invalid pattern rejected", "agent pattern and transport applied by audio callback", "sample clock advances", "keyboard waveform change", "mouse step edit", "CPAL output captured through private PulseAudio sink", "stop produces silence", "native Bevy screenshot"], "active_state": active, "loopback_rms": rms, "loopback_peak": peak, "recorded_frames": len(samples), "limitations": ["Virtual Linux audio device, not physical speakers", "No macOS hardware or signing proof", "No paid inference; direct authenticated MCP client"]}
    (out / "proof.json").write_text(json.dumps(proof, indent=2))
    stop(app)
    assert app.returncode == 0, f"Native app exited {app.returncode}"
    assert not (profile / "bridge.json").exists(), "Discovery file leaked on shutdown"
    print(json.dumps({"passed": True, "out": str(out), "rms": rms, "peak": peak}))
finally:
    for process in reversed(processes):
        stop(process)
    for log in logs:
        log.close()
