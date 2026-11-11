# 当前版本验证记录

验证日期：2026-11-11（北京时间）。

## 已通过

- 25 项 JavaScript 数据与 DOM / native IPC 模拟交互测试，执行 `npm test`。
- 8 项真实 SQLite Rust 测试，执行 `cargo test --locked --manifest-path src-tauri/Cargo.toml -p shixu-storage`。覆盖重启读写、事务失败回滚、冲突保护、WAL 备份、恢复前快照、损坏与其他格式数据库拒绝、自动备份去重及异常输入。
- 原网页版本曾使用用户上传的 CSV 验证：52 行可新增，再次导入 52 行均未变化，未推断实际完成日；原始文件未放进源码或发布资源。
- 原生保存失败保留编辑框和原数据；桥接故障不回退浏览器存储；JSON 迁移取消备份时不恢复；周报表格通过原生 HTML 剪贴板命令。

## 未验证与阻塞

- 当前执行机是 Linux，没有 macOS SDK，不能产出或运行经过验证的 Apple Silicon `.app` / `.dmg`。
- 尝试完整 Tauri `cargo check --locked`，在 `glib-sys` 阶段因缺少 `glib-2.0` 系统开发库失败；本机也缺少 WebKitGTK。原生窗口命令未完成整体编译验证。
- macOS 系统对话框、剪贴板、真实布局和语雀粘贴尚未真机验证。提供 Mac 构建脚本和手动触发的 GitHub Actions 打包工作流，尚未执行远程构建。
- 之前网页的平台预览因 relay 等待端口超时而失败；没有用 DOM 模拟替代真实浏览器视觉验证。

此版本包含客户端源码与构建工作流；在线站点未更新，macOS 安装包尚未构建。
