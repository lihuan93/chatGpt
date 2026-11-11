#!/bin/bash
cd "$(dirname "$0")" || exit 1
bash scripts/build-mac.sh
result=$?
if [[ $result -ne 0 ]]; then printf '\n构建未完成，请查看上面的提示。\n'; fi
read -r -p '按回车关闭窗口…'
exit "$result"
