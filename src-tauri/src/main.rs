#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  net::TcpStream,
  path::PathBuf,
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::Duration,
};

use tauri::{Manager, RunEvent};

struct ServerProcess(Mutex<Option<Child>>);

fn main() {
  let app = tauri::Builder::default()
    .manage(ServerProcess(Mutex::new(None)))
    .setup(|app| {
      if !is_server_running() {
        let child = start_server(app.handle())?;
        *app.state::<ServerProcess>().0.lock().expect("server process lock") = Some(child);
        wait_for_server();
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building BiliNote AI");

  app.run(|app_handle, event| {
    if matches!(event, RunEvent::Exit) {
      let child = {
        let state = app_handle.state::<ServerProcess>();
        let child = state.0.lock().expect("server process lock").take();
        child
      };
      if let Some(mut child) = child {
        let _ = child.kill();
      }
    }
  });
}

fn start_server(app: &tauri::AppHandle) -> Result<Child, Box<dyn std::error::Error>> {
  if cfg!(debug_assertions) {
    let project_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .parent()
      .expect("project directory")
      .to_path_buf();

    let mut command = Command::new(npm_command());
    command
      .args(["run", "dev:server"])
      .current_dir(project_dir)
      .env("PORT", "3001")
      .stdin(Stdio::null())
      .stdout(Stdio::inherit())
      .stderr(Stdio::inherit());
    return Ok(command.spawn()?);
  }

  let resource_dir = app.path().resource_dir()?;
  let node_bin = bundled_binary(app, "node")?;
  let ffmpeg_bin = bundled_binary(app, "ffmpeg")?;
  let yt_dlp_bin = bundled_binary(app, "yt-dlp")?;
  let whisper_cli_bin = bundled_binary(app, "whisper-cli")?;
  let server_path = resource_dir.join("dist-server").join("server.js");
  let client_dist_dir = resource_dir.join("dist");
  let app_data_dir = app.path().app_data_dir()?;

  let mut command = Command::new(node_bin);
  command
    .arg(server_path)
    .current_dir(resource_dir)
    .env("NODE_ENV", "production")
    .env("PORT", "3001")
    .env("CLIENT_DIST_DIR", client_dist_dir)
    .env("BILINOTE_DATA_DIR", app_data_dir)
    .env("FFMPEG_BIN_PATH", ffmpeg_bin)
    .env("ONLINE_VIDEO_DOWNLOADER_BIN_PATH", yt_dlp_bin)
    .env("WHISPER_BIN_PATH", whisper_cli_bin)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());

  Ok(command.spawn()?)
}

fn wait_for_server() {
  for _ in 0..80 {
    if is_server_running() {
      return;
    }
    thread::sleep(Duration::from_millis(250));
  }
}

fn is_server_running() -> bool {
  TcpStream::connect(("127.0.0.1", 3001)).is_ok()
}

fn bundled_binary(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
  let mut candidates = Vec::new();
  if let Ok(exe_path) = std::env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      candidates.push(exe_dir.join(name));
    }
  }
  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(resource_dir.join(name));
    candidates.push(resource_dir.join("sidecars").join(name));
  }

  for candidate in candidates {
    if candidate.is_file() {
      return Ok(candidate);
    }
  }

  Err(format!("Missing bundled sidecar: {name}").into())
}

fn npm_command() -> &'static str {
  if cfg!(windows) {
    "npm.cmd"
  } else {
    "npm"
  }
}
