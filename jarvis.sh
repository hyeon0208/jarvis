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

  # 옵션 파싱:
  #   jarvis logs [N]                 — N줄부터 tail -f (기존 동작, 기본 50)
  #   jarvis logs --level ERROR       — ERROR만
  #   jarvis logs --user slack:U07    — 특정 유저
  #   jarvis logs --channel slack     — 특정 채널
  #   jarvis logs --no-follow         — follow 없이 한 번만
  # 필터는 AND 조합.
  local lines=50
  local follow="-f"
  local level=""
  local user=""
  local channel=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --level)        level="$2"; shift 2 ;;
      --user)         user="$2"; shift 2 ;;
      --channel)      channel="$2"; shift 2 ;;
      --no-follow|-n) follow=""; shift ;;
      --follow|-f)    follow="-f"; shift ;;
      -h|--help)
        cat <<'USAGE'
사용법: jarvis logs [N] [옵션]
  N              최근 N줄부터 (기본 50)
  --level LV     ERROR | WARN | INFO
  --user ID      특정 user_id만 (예: slack:U07ABC)
  --channel CH   특정 채널만 (telegram | slack | discord)
  --no-follow    tail -f 없이 한 번만 출력
  --follow, -f   실시간 추적 (기본 동작)

예:
  jarvis logs --level ERROR
  jarvis logs --channel slack --user slack:U07ABC
  jarvis logs 200 --no-follow --level WARN
USAGE
        return 0 ;;
      [0-9]*)         lines="$1"; shift ;;
      *)
        echo "알 수 없는 옵션: $1 (jarvis logs --help)" >&2
        return 1 ;;
    esac
  done

  # 필터 정규식 조립 (AND — grep 파이프 체이닝)
  local cmd="tail $follow -n $lines \"$LOG_FILE\""
  [ -n "$level" ]   && cmd="$cmd | grep -E --line-buffered \"\\[${level}\\]\""
  [ -n "$user" ]    && cmd="$cmd | grep -F --line-buffered \"${user}\""
  [ -n "$channel" ] && cmd="$cmd | grep -E --line-buffered \"\\[${channel}\\]|${channel}:\""
  eval "$cmd"
}

SYSTEM_PROMPT="You are Jarvis, a personalized AI agent.

[Self-knowledge]
- Project guide: ~/jarvis/CLAUDE.md (directory layout, commands, absolute rules)
- Overview: ~/jarvis/docs/00-overview.md
- If asked about yourself/Jarvis internals, Read those files first before answering.

[Pre-task self-check]
1. Check relevant memory: jarvis_memory_recall(query, type:'declarative')
2. Check similar past work: jarvis_session_search(query)
3. Check related skills: jarvis_memory_recall(query, type:'procedural')
4. If your work changes code/config, sync docs accordingly (absolute rule)

[IntentGate]
First judge the intent and complexity of the request. For standard/deep complexity, steps 1-3 are mandatory.
If the user invokes /jarvis, follow the procedure in ~/jarvis/skills/jarvis/SKILL.md.

Respond in Korean (한국어).
Respond in plain text. Do not use markdown syntax: no **bold**, *italic*, _underline_, # headings, \`inline code\`, or \`\`\`code blocks\`\`\`. Simple hyphen bullets (- item) are fine."

build_owner_prompt() {
  # owner의 personality(말투/언어/호칭)를 시스템 프롬프트에 합성
  local personality_prompt=""
  if command -v bun >/dev/null 2>&1; then
    personality_prompt=$(bun run "$HOME/jarvis/scripts/owner-personality-prompt.ts" 2>/dev/null || true)
  fi

  if [ -n "$personality_prompt" ]; then
    printf '%s\n\n[Owner Personality]\n%s' "$SYSTEM_PROMPT" "$personality_prompt"
  else
    printf '%s' "$SYSTEM_PROMPT"
  fi
}

cmd_chat() {
  echo -e "${GREEN}Jarvis 대화 모드 시작...${NC}"
  echo -e "종료: Ctrl+C 또는 /exit"
  echo ""

  # 진입 시 빠른 자가 진단 (실패해도 계속 진행)
  if [ -z "$JARVIS_SKIP_DOCTOR" ] && command -v bun >/dev/null 2>&1; then
    bun run "$HOME/jarvis/scripts/doctor.ts" --quick --silent-ok 2>/dev/null || true
  fi

  # Owner 로컬 세션 — user_id 격리 + owner.json의 personality 자동 반영
  local prompt
  prompt=$(build_owner_prompt)

  JARVIS_USER_ID="owner" JARVIS_CHANNEL="terminal" claude \
    --append-system-prompt "$prompt" \
    --name "Jarvis"
}

cmd_ask() {
  local prompt="$*"
  if [ -z "$prompt" ]; then
    echo -e "${RED}질문을 입력하세요: $0 ask \"질문 내용\"${NC}"
    return 1
  fi

  local sys_prompt
  sys_prompt=$(build_owner_prompt)

  JARVIS_USER_ID="owner" JARVIS_CHANNEL="terminal" claude -p "$prompt" \
    --append-system-prompt "$sys_prompt"
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
  pair)             shift; bun run "$HOME/jarvis/scripts/pair.ts" "$@" ;;
  list)             shift; bun run "$HOME/jarvis/scripts/list.ts" "$@" ;;
  doctor)           shift; bun run "$HOME/jarvis/scripts/doctor.ts" "$@" ;;
  project)          shift; bun run "$HOME/jarvis/scripts/project.ts" "$@" ;;
  channel)          shift; bun run "$HOME/jarvis/scripts/channel.ts" "$@" ;;
  user)             shift; bun run "$HOME/jarvis/scripts/user.ts" "$@" ;;
  cron)             shift; bun run "$HOME/jarvis/scripts/cron.ts" "$@" ;;
  edit-profile)     shift; bun run "$HOME/jarvis/scripts/edit-profile.ts" "$@" ;;
  add-project)      bun run "$HOME/jarvis/scripts/add-project.ts" ;;
  add-channel)      bun run "$HOME/jarvis/scripts/add-channel.ts" ;;
  install-mcp)      shift; bun run "$HOME/jarvis/scripts/install-mcp.ts" "$@" ;;
  help|--help|-h)   ;; # 아래 기본 출력으로
  *)
    echo -e "Jarvis"
    echo ""
    echo -e "${GREEN}대화${NC}"
    echo "  chat                       Jarvis와 대화 모드 시작"
    echo "  ask \"...\"                  한 번 질문하고 답변 받기"
    echo ""
    echo -e "${GREEN}데몬${NC}"
    echo "  start/stop/restart         백그라운드 데몬 제어"
    echo "  status                     실행 상태 확인"
    echo "  logs [N]                   데몬 로그 실시간 표시"
    echo "  install/uninstall          맥 부팅 자동 시작 등록/해제"
    echo ""
    echo -e "${GREEN}설정${NC}"
    echo "  create-profile             프로필 생성 마법사"
    echo "  edit-profile <name>        기존 프로필 수정 마법사"
    echo "  add-project                프로젝트 추가 마법사"
    echo "  add-channel                채널 추가 마법사"
    echo "  install-mcp [--dry-run]    Claude Code settings.json 자동 패치"
    echo ""
    echo -e "${GREEN}조회${NC}"
    echo "  list profiles|users|channels|pending   목록 조회"
    echo "  doctor [--quick]           전체 진단"
    echo ""
    echo -e "${GREEN}관리${NC}"
    echo "  pair list                  페어링 대기 목록"
    echo "  pair approve <code> <profile>  페어링 승인"
    echo "  pair reject <user_id>      페어링 거부"
    echo "  project add|rm|ls          프로젝트 CRUD"
    echo "  channel ls|enable|disable|token <name> [value]"
    echo "  user ls|show|profile|rename|rm <user_id>"
    echo "  cron list [user_id] | run <job_id> [--send]  cron_jobs 조회/수동 실행"
    echo "  cron recipients <job_id> [add|remove|clear] <uid>...  브로드캐스트 수신자 관리"
    ;;
esac
