#!/bin/bash

# Jarvis Setup Script
# Claude Code에 Jarvis MCP 서버, 훅, 스킬을 등록합니다.

set -e

JARVIS_DIR="$HOME/jarvis"
CLAUDE_DIR="$HOME/.claude"
JARVIS_DATA_DIR="$HOME/.jarvis"

echo "=== Jarvis 설치 시작 ==="

# 1. 의존성 설치
echo "[1/6] 의존성 설치..."
cd "$JARVIS_DIR"
bun install --silent

# 2. 데이터 디렉토리 생성
echo "[2/6] 데이터 디렉토리 생성..."
mkdir -p "$JARVIS_DATA_DIR/data"
mkdir -p "$JARVIS_DATA_DIR/sessions"

# 3. 스킬 심볼릭 링크
echo "[3/6] 스킬 심볼릭 링크..."
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
echo "[4/6] 스킬 스캔..."
node "$JARVIS_DIR/hooks/scan-skills.js"

# 5. jarvis 명령 글로벌 등록
echo "[5/6] jarvis 명령 등록..."
JARVIS_BIN="$HOME/.local/bin/jarvis"
mkdir -p "$HOME/.local/bin"
if [ -L "$JARVIS_BIN" ] || [ -f "$JARVIS_BIN" ]; then
  echo "  - jarvis: 이미 등록됨 (스킵)"
else
  ln -s "$JARVIS_DIR/jarvis.sh" "$JARVIS_BIN"
  echo "  - jarvis → $JARVIS_DIR/jarvis.sh"
fi

# PATH 안내
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
  echo ""
  echo "  ※ ~/.local/bin이 PATH에 없습니다. 셸 설정에 추가하세요:"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "[6/6] Claude Code settings.json 패치..."
bun run "$JARVIS_DIR/scripts/install-mcp.ts"

echo ""
echo "=== Jarvis 설치 완료 ==="
echo ""
echo "다음 단계:"
echo "  1. Claude Code 재시작 (MCP 서버 로드)"
echo "  2. jarvis doctor 로 진단"
echo "  3. jarvis start 로 데몬 시작"
echo ""
echo "유용한 명령:"
echo "  jarvis                  — 전체 명령어 도움말"
echo "  jarvis create-profile   — 프로필 생성"
echo "  jarvis add-project      — 프로젝트 추가"
echo "  jarvis add-channel      — 채널 추가"
