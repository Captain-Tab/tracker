#!/bin/bash
# start-server.sh - Debug 日志收集服务管理
# 使用方式: bash start-server.sh <check|start|stop|status> [project-root]

set -e

COMMAND="${1:-}"
PROJECT_ROOT="${2:-$(pwd)}"

# 获取 soso-kit 根目录
if [ -f ".claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(pwd)"
elif [ -f "../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd .. && pwd)"
elif [ -f "../../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd ../.. && pwd)"
else
    echo "ERROR: 未找到 soso-kit 配置"
    exit 1
fi

SERVER_JS="$KIT_ROOT/.claude/kit/debug/server.js"
PID_FILE="$PROJECT_ROOT/.debug-server.pid"
BASE_PORT="${DEBUG_PORT:-9876}"

case "$COMMAND" in
    check)
        # 验证 node 可用
        NODE_OK=false
        if command -v node &>/dev/null; then
            NODE_OK=true
        fi

        # 检查端口是否空闲
        PORT_FREE=false
        if ! lsof -i ":$BASE_PORT" &>/dev/null; then
            PORT_FREE=true
        fi

        echo "{\"node\": $NODE_OK, \"port_free\": $PORT_FREE, \"port\": $BASE_PORT, \"project_root\": \"$PROJECT_ROOT\"}"
        ;;

    start)
        if [ -f "$PID_FILE" ]; then
            OLD_PID=$(cat "$PID_FILE")
            if kill -0 "$OLD_PID" 2>/dev/null; then
                echo "服务已在运行 (PID: $OLD_PID)"
                exit 0
            fi
            rm -f "$PID_FILE"
        fi

        # 后台启动服务，捕获输出获取实际端口
        node "$SERVER_JS" "$PROJECT_ROOT" &
        SERVER_PID=$!
        echo "$SERVER_PID" > "$PID_FILE"

        # 等待服务启动
        sleep 1

        if kill -0 "$SERVER_PID" 2>/dev/null; then
            echo "服务已启动 (PID: $SERVER_PID)"
        else
            echo "ERROR: 服务启动失败"
            rm -f "$PID_FILE"
            exit 1
        fi
        ;;

    stop)
        if [ ! -f "$PID_FILE" ]; then
            echo "服务未运行"
            exit 0
        fi

        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null || true
            # 等待进程退出
            for i in $(seq 1 5); do
                if ! kill -0 "$PID" 2>/dev/null; then
                    break
                fi
                sleep 0.5
            done
            # 强制终止
            if kill -0 "$PID" 2>/dev/null; then
                kill -9 "$PID" 2>/dev/null || true
            fi
        fi

        rm -f "$PID_FILE"
        echo "服务已停止"
        ;;

    status)
        if [ ! -f "$PID_FILE" ]; then
            echo "{\"running\": false}"
            exit 0
        fi

        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "{\"running\": true, \"pid\": $PID}"
        else
            rm -f "$PID_FILE"
            echo "{\"running\": false}"
        fi
        ;;

    *)
        echo "用法: bash start-server.sh <check|start|stop|status> [project-root]"
        exit 1
        ;;
esac
