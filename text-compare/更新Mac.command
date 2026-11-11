#!/bin/bash
# Finder 双击及 `sh 更新Mac.command` 都使用 macOS 自带的 Bash。
if [ -z "${BASH_VERSION:-}" ] || shopt -oq posix; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

fail() { printf '\n更新未完成：%s\n请保留 Chrome 中原扩展条目。\n' "$1"; exit 1; }
trap 'printf "\n更新中断。代码备份（如已创建）：%s\n请保留原安装目录，排除错误后可重新运行升级脚本。\n" "${backup_dir:-尚未创建}"' ERR
package_dir="$(cd "$(dirname "$0")" && pwd -P)"
source_dir="$package_dir/diffnote"
if [ -r "$package_dir/extension/manifest.json" ]; then
  source_dir="$package_dir/extension"
fi
[ -r "$source_dir/manifest.json" ] || fail '找不到升级包中的 manifest.json。请完整解压升级包后运行。'
source_dir="$(cd "$source_dir" && pwd -P)"

validate_manifest() {
  /usr/bin/osascript -l JavaScript - "$1" <<'JXA'
ObjC.import('Foundation');
function run(argv) {
  var root = argv[0];
  var raw = $.NSString.stringWithContentsOfFileEncodingError(root + '/manifest.json', $.NSUTF8StringEncoding, null);
  if (!raw) throw Error('manifest.json 不可读取');
  var m = JSON.parse(ObjC.unwrap(raw));
  if (m.manifest_version !== 3 || m.name !== 'DiffNote · 文本对比') throw Error('不是 DiffNote 文本对比扩展');
  if (typeof m.version !== 'string' || !m.version) throw Error('版本号无效');
  var files = ['index.html', 'app.js', 'diff.js', 'style.css', 'vendor/code-editor.js', 'vendor/code-editor.LICENSE.txt'];
  if (!m.background || !m.background.service_worker || !m.icons || !m.action) throw Error('扩展清单缺少入口');
  files.push(m.background.service_worker);
  Object.keys(m.icons).forEach(function(size) { files.push(m.icons[size]); });
  Object.keys(m.action.default_icon || {}).forEach(function(size) { files.push(m.action.default_icon[size]); });
  files.forEach(function(file) {
    if (typeof file !== 'string' || !file || file.charAt(0) === '/' || file.split('/').some(function(p) { return p === '..' || p === '.'; })) throw Error('清单路径无效');
    if (!$.NSFileManager.defaultManager.isReadableFileAtPath(root + '/' + file)) throw Error('缺少文件：' + file);
  });
  return 'DiffNote 校验通过：' + m.version;
}
JXA
}

validate_target() {
  /usr/bin/osascript -l JavaScript - "$1" <<'JXA'
ObjC.import('Foundation');
function run(argv) {
  var root = argv[0];
  function read(file) {
    var raw = $.NSString.stringWithContentsOfFileEncodingError(root + '/' + file, $.NSUTF8StringEncoding, null);
    return raw ? ObjC.unwrap(raw) : '';
  }
  var m = null;
  try { m = JSON.parse(read('manifest.json')); } catch (_) {}
  if (m && m.name === 'DiffNote · 文本对比' && m.manifest_version === 3) return '原目录已确认';
  if (m) throw Error('此目录的清单不是 DiffNote，已停止');
  // 支持修复损坏/缺失的清单，同时防止误选普通文件夹或其他扩展。
  if (read('index.html').indexOf('<title>DiffNote · 文本对比</title>') < 0 ||
      read('app.js').indexOf('function renderCode(') < 0 ||
      read('diff.js').indexOf('compareText') < 0) throw Error('未能确认这是原 DiffNote 目录');
  return '已确认旧版代码，将修复缺失或损坏的清单';
}
JXA
}

validate_manifest "$source_dir" || fail '新版文件不完整，未修改原目录。'
printf '\n请选择 Chrome 原来加载的 DiffNote 安装文件夹。\n原文件夹根层应有 manifest.json；不要选择刚解压的新包。\n'
if [ "$#" -gt 0 ]; then
  target_dir="$1"
else
  target_dir="$(/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "选择 Chrome 原来加载的 DiffNote 文件夹（不要选择新升级包）")')" || exit 0
fi
[ -d "$target_dir" ] || fail '选择的文件夹不存在。'
target_dir="$(cd "$target_dir" && pwd -P)"
case "$target_dir/" in "$source_dir/"*) fail '选择了新版目录或其子目录。请重新选择原安装文件夹。';; esac
case "$source_dir/" in "$target_dir/"*) fail '新版目录位于目标目录内。请把升级包解压到独立位置再运行。';; esac
validate_target "$target_dir" || fail '请重新选择 Chrome 原来加载的 DiffNote 文件夹。'

# 在备份和复制之前检查所有目标路径，避免沿符号链接写到其他目录。
while IFS= read -r -d '' source_file; do
  relative="${source_file#"$source_dir/"}"
  target_file="$target_dir/$relative"
  check_path="$target_file"
  while [ "$check_path" != "$target_dir" ]; do
    [ ! -L "$check_path" ] || fail '目标文件或其父目录为符号链接，请先检查原安装目录。'
    check_path="$(dirname "$check_path")"
  done
  [ ! -d "$target_file" ] || fail '目标文件被同名文件夹占用，请先检查原目录。'
done < <(find "$source_dir" -type f -print0)

backup_dir="$(mktemp -d "$(dirname "$target_dir")/diffnote-backup.XXXXXX")"
/usr/bin/ditto "$target_dir" "$backup_dir"
printf '\n原代码已备份到：%s\n正在原目录更新：%s\n' "$backup_dir" "$target_dir"
# 不删除、不移动、不替换原文件夹。先复制资源，最后写清单。
while IFS= read -r -d '' source_file; do
  relative="${source_file#"$source_dir/"}"
  [ "$relative" = 'manifest.json' ] && continue
  mkdir -p "$(dirname "$target_dir/$relative")"
  /bin/cp "$source_file" "$target_dir/$relative"
done < <(find "$source_dir" -type f -print0)
/bin/cat "$source_dir/manifest.json" > "$target_dir/manifest.json"
validate_manifest "$target_dir" || fail '更新后校验失败，旧代码已备份，请检查文件访问权限。'
while IFS= read -r -d '' source_file; do
  relative="${source_file#"$source_dir/"}"
  /usr/bin/cmp -s "$source_file" "$target_dir/$relative" || fail '更新后的文件内容不一致，请保留备份。'
done < <(find "$source_dir" -type f -print0)
printf '\n升级完成。返回 chrome://extensions，在原 DiffNote 条目点击“重新加载”；错误弹窗可点击“重试”。\n然后关闭旧的对比标签页，重新点击扩展图标打开。不要卸载扩展或更换安装路径。\n此备份只包含扩展代码；对比页未保存的文本不在备份中。\n'
