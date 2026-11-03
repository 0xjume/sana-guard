// Bakes the git commit into the contract so `version()` can report what is deployed.
// Prefer `SANA_GUARD_GIT_SHA` when set (CI / `cargo near` images without `.git`).
// If git is missing or the command fails, fall back to "unknown" so the build still works.
use std::process::Command;

fn main() {
    let sha = std::env::var("SANA_GUARD_GIT_SHA")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(git_sha);
    println!("cargo:rustc-env=SANA_GUARD_GIT_SHA={sha}");
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/index");
    println!("cargo:rerun-if-env-changed=SANA_GUARD_GIT_SHA");
}

fn git_sha() -> String {
    let sha = Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    let dirty = Command::new("git")
        .args(["status", "--porcelain", "--untracked-files=no"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| !out.stdout.is_empty())
        .unwrap_or(false);
    if dirty && sha != "unknown" {
        format!("{sha}-dirty")
    } else {
        sha
    }
}
