# 拾序 Mac 客户端（Apple Silicon）

这是现有个人工作台的 Tauri 2 桌面版本，面向 M1 Pro 等 Apple Silicon Mac。界面和任务业务规则复用 `dist/`；日常数据写入本机 SQLite，不依赖 GPT 登录或在线站点。

目前已实现客户端源码、SQLite 持久化、备份恢复、原生文件导出与剪贴板，并通过数据及交互测试。开发环境是 Linux，未在 macOS 上完成原生编译、DMG 生成或真机验证；不能把此源码包当成已经验证可安装的客户端。

## 构建与安装

需要 macOS 12+、Apple Silicon、Node.js 24+、Rust stable（通过 rustup 安装）及 Apple Command Line Tools。首次构建下载依赖，需要联网；构建完成后的客户端可离线运行。

1. 安装 Apple 工具：终端执行 `xcode-select --install`。
2. 从 https://nodejs.org/ 安装 Node.js；从 https://rustup.rs/ 安装 Rust。重新打开终端，让 `cargo` 可用。
3. 在项目目录双击 `构建Mac客户端.command`；或者终端执行 `bash scripts/build-mac.sh`。
4. 脚本检查环境、安装开发依赖、运行测试、构建 `aarch64-apple-darwin` 的 `.app` 和 `.dmg`，完成后打开产物目录。
5. 打开 DMG，把“拾序”拖入 Applications。以后从 Dock 或启动台打开。

输出目录：`src-tauri/target/aarch64-apple-darwin/release/bundle/`。本版采用本地 ad-hoc 签名，没有 Apple Developer ID 签名和公证；下载的安装文件首次打开可能需要在 macOS“隐私与安全性”中确认来源。不会要求关闭系统安全保护。

仓库还提供手动触发的 GitHub Actions 工作流 `.github/workflows/shixu-mac.yml`，在 macOS runner 构建 Apple Silicon DMG 并上传为私有构建产物，不创建 Release、不发布到公共下载站。工作流需提交推送后才能触发，目前尚未运行。

开发启动：`npm run desktop:dev`。它从打包的本地静态资源加载界面，无需另开网页服务器。

## 数据在哪里

macOS 标准目录：

```text
~/Library/Application Support/com.shixu.workspace/
  shixu.sqlite
  shixu.sqlite-wal       # SQLite 工作文件，可能出现
  shixu.sqlite-shm       # SQLite 工作文件，可能出现
  backups/              # 自动备份与恢复前快照
```

客户端左下角“本机数据”可以查看真实路径、打开 Finder 目录、立即备份、恢复或重新加载。

数据库结构包括项目、任务、工作记录、周报、周报任务关联和导入历史。来源与任务 ID 的唯一索引避免重复任务，外键维护关联。关键查询字段单独建列，其余字段保留 JSON，兼顾查询与后续字段扩展。

第一版按工作台快照在事务中原子保存；界面只有收到成功响应后才显示“已保存”。写入错误时不关闭编辑框，不改成保存到浏览器。版本号检查阻止旧编辑覆盖新数据，单实例控制避免重复启动两个工作窗口。

数据库默认不做独立加密、不做云同步、不连接外部 AI 服务。退出或更新应用不会主动删除数据；卸载应用也不自动清理此目录。

## 备份和恢复

- **SQLite 备份**：在“本机数据”中选择“备份数据库”。使用 SQLite 在线备份 API，包含已提交的 WAL 内容。请使用新的文件名，已有备份不覆盖。
- **自动备份**：启动以及保存时检查北京时间日期；每天首次保留一份当天操作前的数据库快照。恢复数据库或从 JSON 替换数据前额外备份当前数据库。自动备份暂不自动删除，可手动整理；建议定期另存到其他磁盘。
- **SQLite 恢复**：选择数据库备份，先做只读校验和完整性检查，再备份当前数据并在事务中替换内容；不会修改所选备份文件。版本不兼容或内容异常时拒绝恢复。
- **JSON 备份**：侧栏“导出备份 / 恢复备份”。用于从网页版迁入，或跨版本迁移全部任务、记录和周报。恢复会替换整个工作台，并要求先保存当前 JSON 备份；用户取消备份时取消恢复。
- 不要在应用运行时只复制 `shixu.sqlite` 单个文件当作完整备份，也不要把正在使用的数据库直接放在网盘同步目录。使用应用内的数据库备份入口。

从网页版迁移：在原浏览器打开工作台 → 导出完整 JSON → 在 Mac 客户端点击“恢复备份”选择文件。客户端不会读取浏览器的 localStorage。原 CSV 可直接在客户端再次导入，但 CSV 不含你的本地记录和周报，不能代替完整 JSON 迁移。

## 工作流程

1. 导入 CSV，在预览中核对新增、更新、个人项目归类和异常行。
2. 在任务上记录实际进展，必要时补充职责、方案、难点、结果，标记为经历素材。
3. 周报中选择日期范围、核对候选任务、编辑事项及完成阶段、合并拆分和排序。
4. 复制五列表格到语雀，或导出 Markdown、CSV、HTML；线上文档地址可保存在周报里，链接用系统浏览器打开。
5. 在工作积累里按项目和日期导出经历素材，后续用于简历或述职。

原生剪贴板支持 HTML 表格和纯文本。语雀接收后的表格样式、macOS 窗口布局、系统文件对话框都需要真机复核。本版不自动写入语雀。

## 测试与构建边界

```sh
npm ci
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml -p shixu-storage
npm run desktop:build -- --ci
```

- JS 测试：浏览器兼容流程；模拟 native IPC 的数据库确认、错误保留编辑、JSON 迁移、HTML 剪贴板、保存对话框路由；native 桥不可用时不回退 localStorage。
- Rust SQLite 测试：真实文件读写、重启、旧版本写入冲突、事务失败回滚、WAL 备份、恢复前快照、损坏和不兼容文件、每天备份去重。
- 当前完整 Tauri 构建在 Linux 因缺少 GLib / WebKitGTK 开发库受阻。SQLite 测试独立于图形环境运行。最终 ARM64 编译、安装和真机体验以 macOS 构建结果为准。
