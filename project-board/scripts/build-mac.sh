#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo '请在 Apple Silicon Mac（M1/M2/M3/M4 等）原生终端运行。'; exit 1
fi
if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --show-sdk-path >/dev/null 2>&1; then
  echo '请先安装 Apple 命令行工具：xcode-select --install'; exit 1
fi
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo '请先安装 Node.js 24 或更高版本：https://nodejs.org/'; exit 1
fi
if ! command -v cargo >/dev/null; then
  echo '请先安装 Rust stable：https://rustup.rs/ ，安装后重新打开终端。'; exit 1
fi
if ! command -v rustup >/dev/null; then
  echo '请通过 rustup 安装 Rust，以便管理 Apple Silicon 编译目标：https://rustup.rs/'; exit 1
fi
rustup target add aarch64-apple-darwin
npm ci
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml -p shixu-storage
npm run desktop:build -- --ci
printf '\n构建完成。安装文件位于：\n%s\n' "$PWD/src-tauri/target/aarch64-apple-darwin/release/bundle"
open src-tauri/target/aarch64-apple-darwin/release/bundle
