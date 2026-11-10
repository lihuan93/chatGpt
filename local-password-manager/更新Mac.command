#!/bin/bash
# `sh 更新Mac.command` 会忽略 shebang；先切换到非 POSIX 模式的 Bash。
# 此段使用 POSIX 语法，必须放在任何 Bash 专用语法之前。
if [ -z "${BASH_VERSION:-}" ] || shopt -oq posix; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

fail() { printf '\n更新未完成：%s\n请不要卸载扩展。\n' "$1"; exit 1; }
trap 'printf "\n执行失败，原目录的代码备份位置（如已创建）：%s\n请保留 Chrome 中原扩展条目。\n" "${backup_dir:-尚未创建}"' ERR
package_dir="$(cd "$(dirname "$0")" && pwd -P)"
source_dir="$package_dir/local-password-manager"
# 同时支持升级 ZIP（脚本旁边是扩展目录）和仓库项目目录内的脚本。
if [ -r "$package_dir/manifest.json" ]; then
  source_dir="$package_dir"
fi
[ -r "$source_dir/manifest.json" ] || fail '找不到更新包中的 manifest.json。请先完整解压，再运行此脚本。'

# macOS 自带 JXA：解析 JSON，并检查清单引用的入口文件。
validate_manifest() {
  /usr/bin/osascript -l JavaScript - "$1" <<'JXA'
ObjC.import('Foundation');
function run(argv) {
  var root = argv[0];
  var text = $.NSString.stringWithContentsOfFileEncodingError(root + '/manifest.json', $.NSUTF8StringEncoding, null);
  if (!text) throw Error('manifest.json 不可读取');
  var m = JSON.parse(ObjC.unwrap(text));
  if (m.manifest_version !== 3 || m.name !== '本地账号簿') throw Error('不是本地账号簿扩展');
  var files = ['index.html','app.js','style.css','core.js','fill.js','popup.js','popup.css',m.action.default_popup,m.icons['128']];
  files.forEach(function(file) {
    if (!file || !$.NSFileManager.defaultManager.isReadableFileAtPath(root + '/' + file)) throw Error('缺少文件：' + file);
  });
  return '校验通过：' + m.version;
}
JXA
}
validate_manifest "$source_dir" || fail '新版文件校验失败，未修改原安装目录。'
printf '\n请选择 Chrome 原来加载的 local-password-manager 目录。\n不要选择刚解压的新版目录，也不要在 Chrome 中删除扩展。\n'
if [ "$#" -gt 0 ]; then
  target_dir="$1"
else
  target_dir="$(/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "选择 Chrome 原安装的 local-password-manager 文件夹（不是新版解压目录）")')" || exit 0
fi
[ -d "$target_dir" ] || fail '选择的目录不存在。'
target_dir="$(cd "$target_dir" && pwd -P)"
[ "$target_dir" != "$source_dir" ] || fail '选择了新版目录。请重新运行并选择原安装目录。'
# 允许修复原目录里缺失或损坏的 manifest，但避免写入任意其他文件夹。
[ "$(basename "$target_dir")" = 'local-password-manager' ] || fail '请选名为 local-password-manager 的原扩展目录。'
[ ! -L "$target_dir/manifest.json" ] || fail '原清单是符号链接，请先检查安装目录。'
target_parent="$(dirname "$target_dir")"
backup_dir="$(mktemp -d "$target_parent/local-password-manager-backup.XXXXXX")"
/usr/bin/ditto "$target_dir" "$backup_dir"
printf '\n原代码已备份到：%s\n' "$backup_dir"
printf '正在原目录更新：%s\n' "$target_dir"
# 保留原安装文件夹，不删除目录。清单在其他文件复制完毕后写入。
while IFS= read -r -d '' source_file; do
  relative="${source_file#"$source_dir/"}"
  [ "$relative" = 'manifest.json' ] && continue
  target_file="$target_dir/$relative"
  [ ! -L "$target_file" ] || fail '目标文件是符号链接，已停止更新。'
  mkdir -p "$(dirname "$target_file")"
  /bin/cp "$source_file" "$target_file"
done < <(find "$source_dir" -type f -print0)
/bin/cat "$source_dir/manifest.json" > "$target_dir/manifest.json"
validate_manifest "$target_dir" || fail '更新后校验失败，请保留备份并检查文件访问权限。'
printf '\n文件更新完成。请返回 chrome://extensions，在原扩展上点“重新加载”；若当前显示错误弹窗，点“重试”。\n不要删除扩展或更换安装路径。\n注意：上面的备份仅包含扩展代码，账号数据仍保存在 Chrome 中；可打开管理页后另行导出 JSON 备份。\n'
