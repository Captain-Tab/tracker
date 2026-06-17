#!/bin/bash
#
# soso-kit 公共配置
#
# 用法：source 此文件获取共享变量
#   source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
#

# 默认 soso-kit 路径（修改此处以匹配你的环境）
DEFAULT_SOSO_KIT_ROOT="$HOME/Documents/code/soso-kit"

# 模式配置文件
SOSOKIT_MODE_FILE="$HOME/.sosokit-mode"
SOSOKIT_DEFAULT_MODE="claude"

# 获取当前配置模式（cursor 或 claude）
get_sosokit_mode() {
    if [[ -f "$SOSOKIT_MODE_FILE" ]]; then
        cat "$SOSOKIT_MODE_FILE"
    else
        echo "$SOSOKIT_DEFAULT_MODE"
    fi
}

# 获取配置目录名（.cursor 或 .claude）
get_config_dir() {
    echo ".$(get_sosokit_mode)"
}
