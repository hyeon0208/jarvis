#!/bin/bash

# Jarvis Setup Script
# Claude Code에 Jarvis MCP 서버, 훅, 스킬을 등록합니다.

set -e

JARVIS_DIR="$HOME/jarvis"
CLAUDE_DIR="$HOME/.claude"
JARVIS_DATA_DIR="$HOME/.jarvis"

echo "=== Jarvis 설치 시작 ==="

# 1. 의존성 설치
echo "[1/5] 의존성 설치..."
cd "$JARVIS_DIR"
bun install --silent

# 2. 데이터 디렉토리 생성
echo "[2/5] 데이터 디렉토리 생성..."
mkdir -p "$JARVIS_DATA_DIR/data"
mkdir -p "$JARVIS_DATA_DIR/sessions"

# 3. 스킬 심볼릭 링크
echo "[3/5] 스킬 심볼릭 링크..."
for skill_dir in "$JARVIS_DIR/skills"/*/; do
  skill_name=$(basename "$skill_dir")
  target="$CLAUDE_DIR/skills/$skill_name"

  if [ -L "$target" ]; then
    echo "  - $skill_name: 이미 연결됨 (스킵)"
  elif [ -d "$target" ]; then
    echo "  - $skill_name: 이미 존재함 (스킵)"
  else
    ln -s "$skill_dir" "$target"
    echo "  - $skill_name: 연결 완료"
  fi
done

# 4. 초기 스킬 스캔
echo "[4/5] 스킬 스캔..."
node "$JARVIS_DIR/hooks/scan-skills.js"

# 5. 안내
echo ""
echo "[5/5] Claude Code 설정 안내"
echo ""
echo "settings.json에 다음을 수동으로 추가하세요:"
echo ""
echo '  "mcpServers": {'
echo '    "jarvis-memory": {'
echo '      "command": "bun",'
echo "      \"args\": [\"run\", \"$JARVIS_DIR/packages/memory-server/src/index.ts\"]"
echo '    }'
echo '  }'
echo ""
echo '  hooks.PostToolUse에 추가:'
echo '  {'
echo '    "matcher": "Edit|Write|MultiEdit|Bash|Agent",'
echo '    "hooks": ['
echo '      {'
echo '        "type": "command",'
echo "        \"command\": \"node \\\"$JARVIS_DIR/hooks/auto-memory.js\\\"\","
echo '        "timeout": 5'
echo '      },'
echo '      {'
echo '        "type": "command",'
echo "        \"command\": \"node \\\"$JARVIS_DIR/hooks/skill-nudge.js\\\"\","
echo '        "timeout": 5'
echo '      }'
echo '    ]'
echo '  }'
echo ""
echo "=== Jarvis 설치 완료 ==="
echo ""
echo "MCP 서버 테스트: bun run $JARVIS_DIR/packages/memory-server/src/index.ts"
echo "스킬 재스캔:     node $JARVIS_DIR/hooks/scan-skills.js"
echo "Dreaming 실행:   node $JARVIS_DIR/hooks/dreaming-cron.js"
