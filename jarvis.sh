#!/bin/bash

# Jarvis Daemon 관리 스크립트
# 사용법: ./jarvis.sh {start|stop|restart|status|logs}

JARVIS_DIR="$HOME/.jarvis"
PID_FILE="$JARVIS_DIR/daemon.pid"
LOG_FILE="$JARVIS_DIR/daemon.log"
DAEMON_SCRIPT="$HOME/jarvis/packages/gateway-server/src/daemon.ts"

# 색상
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

get_pid() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE"
  fi
}

is_running() {
  local pid=$(get_pid)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

cmd_start() {
  if is_running; then
    echo -e "${YELLOW}Jarvis는 이미 실행 중입니다 (PID: $(get_pid))${NC}"
    return 1
  fi

  echo -e "${GREEN}Jarvis Daemon 시작 중...${NC}"
  mkdir -p "$JARVIS_DIR"

  # 백그라운드로 실행
  nohup bun run "$DAEMON_SCRIPT" >> "$LOG_FILE" 2>&1 &
  local pid=$!

  sleep 2

  if kill -0 "$pid" 2>/dev/null; then
    echo "$pid" > "$PID_FILE"
    echo -e "${GREEN}Jarvis Daemon 시작됨 (PID: $pid)${NC}"
    echo -e "로그: tail -f $LOG_FILE"
  else
    echo -e "${RED}Jarvis Daemon 시작 실패${NC}"
    echo -e "로그 확인: cat $LOG_FILE | tail -20"
    return 1
  fi
}

cmd_stop() {
  if ! is_running; then
    echo -e "${YELLOW}Jarvis가 실행 중이 아닙니다${NC}"
    # PID 파일 정리
    rm -f "$PID_FILE"
    return 0
  fi

  local pid=$(get_pid)
  echo -e "${YELLOW}Jarvis Daemon 종료 중... (PID: $pid)${NC}"
  kill "$pid" 2>/dev/null

  # 최대 10초 대기
  for i in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  # 아직 살아있으면 강제 종료
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null
  fi

  rm -f "$PID_FILE"
  echo -e "${GREEN}Jarvis Daemon 종료됨${NC}"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  if is_running; then
    local pid=$(get_pid)
    echo -e "${GREEN}● Jarvis Daemon 실행 중${NC}"
    echo -e "  PID:  $pid"
    echo -e "  로그: $LOG_FILE"

    # 활성 채널 확인
    if [ -f "$LOG_FILE" ]; then
      echo -e "\n  활성 채널:"
      grep -o ".*리스너 활성화됨" "$LOG_FILE" | tail -3 | while read line; do
        echo -e "    ✓ $line"
      done
    fi
  else
    echo -e "${RED}● Jarvis Daemon 중지됨${NC}"
  fi
}

cmd_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "로그 파일이 없습니다."
    return 1
  fi

  local lines=${1:-50}
  tail -f -n "$lines" "$LOG_FILE"
}

SYSTEM_PROMPT="당신은 Jarvis입니다. 사용자의 개인화된 AI 에이전트로서 다음 역할을 수행합니다:
- IntentGate: 요청의 의도와 복잡도를 분석하여 최적 대응
- 메모리: jarvis_memory_recall/save로 과거 맥락을 활용
- 스킬 매칭: jarvis_memory_recall(type:procedural)로 관련 스킬 탐색
- 세션 검색: jarvis_session_search로 유사한 과거 작업 참조
항상 한국어로 응답하세요. 사용자가 /jarvis 커맨드를 사용하면 해당 스킬의 절차를 따르세요."

cmd_chat() {
  echo -e "${GREEN}Jarvis 대화 모드 시작...${NC}"
  echo -e "종료: Ctrl+C 또는 /exit"
  echo ""

  claude \
    --append-system-prompt "$SYSTEM_PROMPT" \
    --name "Jarvis"
}

cmd_ask() {
  local prompt="$*"
  if [ -z "$prompt" ]; then
    echo -e "${RED}질문을 입력하세요: $0 ask \"질문 내용\"${NC}"
    return 1
  fi

  claude -p "$prompt" \
    --append-system-prompt "$SYSTEM_PROMPT"
}

PLIST_SRC="$HOME/jarvis/config/com.jarvis.daemon.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.jarvis.daemon.plist"

cmd_install() {
  echo -e "${GREEN}launchd에 Jarvis 등록 중...${NC}"

  if [ -f "$PLIST_DST" ]; then
    launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null
  fi

  cp "$PLIST_SRC" "$PLIST_DST"
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

  echo -e "${GREEN}등록 완료! 맥 부팅 시 자동으로 Jarvis가 시작됩니다.${NC}"
  echo -e "지금 시작하려면: $0 start"
}

cmd_uninstall() {
  echo -e "${YELLOW}launchd에서 Jarvis 해제 중...${NC}"

  if [ -f "$PLIST_DST" ]; then
    launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null
    rm -f "$PLIST_DST"
    echo -e "${GREEN}해제 완료${NC}"
  else
    echo -e "${YELLOW}등록된 서비스가 없습니다${NC}"
  fi
}

# 메인
case "${1:-}" in
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs "${2:-50}" ;;
  install)          cmd_install ;;
  uninstall)        cmd_uninstall ;;
  chat)             cmd_chat ;;
  ask)              shift; cmd_ask "$@" ;;
  create-profile)   bun run "$HOME/jarvis/scripts/create-profile.ts" ;;
  *)
    echo "Jarvis"
    echo ""
    echo "사용법: $0 {chat|ask|start|stop|restart|status|logs|install|uninstall|create-profile}"
    echo ""
    echo "  ${GREEN}chat${NC}             Jarvis와 대화 모드 시작"
    echo "  ${GREEN}ask${NC} \"...\"        한 번 질문하고 답변 받기"
    echo "  ${GREEN}create-profile${NC}   프로필 생성 마법사"
    echo ""
    echo "  start            백그라운드 데몬 시작"
    echo "  stop             데몬 종료"
    echo "  restart          데몬 재시작"
    echo "  status           실행 상태 확인"
    echo "  logs [N]         데몬 로그 실시간 표시"
    echo "  install          맥 부팅 시 자동 시작 등록 (launchd)"
    echo "  uninstall        자동 시작 해제"
    ;;
esac
