# 백그라운드 데몬

## 개요

Jarvis Daemon은 **터미널 없이 백그라운드에서 상시 대기**하며, Telegram 봇의 메시지를 자동으로 처리합니다.

## 기본 명령

```bash
jarvis start      # 데몬 시작
jarvis stop       # 데몬 종료
jarvis restart    # 재시작
jarvis status     # 실행 상태 확인
jarvis logs       # 실시간 로그 (tail -f)
jarvis logs 100   # 최근 100줄부터 표시
```

## 시작 예시

```bash
$ jarvis start
Jarvis Daemon 시작 중...
Jarvis Daemon 시작됨 (PID: 55365)
로그: tail -f /Users/hyeonjun/.jarvis/daemon.log

$ jarvis status
● Jarvis Daemon 실행 중
  PID:  55365
  로그: /Users/hyeonjun/.jarvis/daemon.log

  활성 채널:
    ✓ Telegram 리스너 활성화됨
```

## 맥 부팅 시 자동 시작 (launchd)

```bash
jarvis install      # 등록 — 재부팅해도 자동 실행
jarvis uninstall    # 해제
```

설치하면 `~/Library/LaunchAgents/com.jarvis.daemon.plist`가 등록됩니다.

- 프로세스가 비정상 종료되면 **자동 재시작**
- 10초 throttle로 무한 재시작 방지

## 데몬이 하는 일

```
매 1분마다 (cron runner):
  - 모든 유저의 cron_jobs를 스캔 → 스케줄 매치 + enabled인 job 실행
  - 응답을 해당 user의 채널로 자동 전송 (중복 실행 방지: last_run_at 추적)

매 1초마다 (Telegram polling, Slack/Discord는 Socket Mode/WebSocket):
  1. 채널 API에 "새 메시지 있어?" 물어봄
  2. 메시지가 있으면:
     ├── 누가 보냈나? → user_id = "{channel}:{external_id}" (예: "slack:U07ABC")
     ├── 등록된 유저인가? → 미등록이면 페어링 코드 발급
     ├── 어떤 프로필인가? → developer, observer 등
     ├── 시스템 커맨드인가? → /help, /status, /clear 등이면 즉시 응답
     ├── /dev 커맨드인가? → 개발 워크플로우 진행
     └── 일반 메시지인가? → 격리 5층 적용 후 claude spawn
```

### 일반 메시지 처리 — 격리 5층

```
[1] 도구 권한
    profile.allowed_tools / disallowed_tools → --allowedTools / --disallowedTools 인자

[2] 디렉토리 화이트리스트
    profile.add_dirs (from_projects 키워드 → projects.jsonc 동적 로드) → --add-dir 인자

[3] cwd 샌드박스 (핵심)
    cwd: ~/.jarvis/sandboxes/{safe-user-id}/   ← 빈 디렉토리
    → Read 도구가 cwd 하위 탐색해도 0건 → 홈 자동 차단

[4] 메모리 격리 (장기)
    env JARVIS_USER_ID, JARVIS_USER_NAME, JARVIS_CHANNEL 주입
    → MCP 서버(jarvis-memory)가 자동으로 user별 데이터 분리

[5] 대화 컨텍스트 (단기)
    user 파일의 claude_session_id (UUID) → --session-id 인자
    → claude가 ~/.claude/projects/.../{uuid}.jsonl에서 이전 대화 자동 복원
    → /clear로 초기화 가능 (새 UUID 발급)
```

자세히는 [02. 아키텍처 — 보안 계층](02-architecture.md#보안-계층) + [06. 메모리 — 사용자별 격리](06-memory.md#사용자별-메모리-격리).

## 자동 승인 (프로필별)

외부 채널 요청은 **매번 허락을 받지 않고** 프로필 권한 범위 내에서 자동 실행됩니다.

`owner`는 고정이고, 나머지는 `config/profiles.yml`에 **예시로 제공된 프로필**의 대략적인 동작입니다.

```
owner            → claude -p "..." --dangerously-skip-permissions
developer (예시)  → claude -p "..." --allowedTools "Read,Write,Edit,Grep,..."
reviewer (예시)   → claude -p "..." --allowedTools "Read,Grep,Glob,..."
observer (예시)   → claude -p "..." --allowedTools "Read,Grep,WebSearch"
```

`developer` 등 팀원용 프로필의 정확한 도구 목록은 `config/profiles.yml`을 참조하거나 `jarvis list profiles`로 확인하세요. 본인 환경에 맞게 `jarvis edit-profile`로 조정할 수 있습니다.

**허용 목록에 없는 도구는 Claude가 호출하려 해도 묻지 않고 자동 거부됩니다.**

> `owner` 프로필은 `skip_permissions: true`로 모든 도구가 자동 허용됩니다.
> 따라서 **Owner 본인에게만 부여**하세요. 다른 팀원에게 `owner` 프로필을 지정하면
> `jarvis` 쉘 명령(Owner CLI)까지 실행할 수 있는 권한을 내주게 됩니다.

## 로그

| 파일 | 내용 |
|------|------|
| `~/.jarvis/daemon.log` | 메인 로그 (메시지 수신/응답/에러) |
| `~/.jarvis/daemon.stdout.log` | launchd stdout (install 시) |
| `~/.jarvis/daemon.stderr.log` | launchd stderr (install 시) |

### 로그 예시

```
[11:20:33] [INFO] === Jarvis Daemon 시작 ===
[11:20:33] [INFO] Telegram 리스너 시작...
[11:20:33] [INFO] Telegram 봇 커맨드 메뉴 등록됨
[11:20:33] [INFO] Telegram 리스너 활성화됨
[11:20:33] [INFO] Jarvis Daemon 대기 중...
[11:21:15] [INFO] 수신: [telegram] 김철수: 이메일 검증 코드 보여줘
[11:21:15] [INFO] cwd 샌드박스: /Users/hyeonjun/.jarvis/sandboxes/telegram_1613476146
[11:21:15] [INFO] claude 실행: profile=developer, session=e01b1e78..., dir=sandbox, prompt=이메일 검증 코드...
[11:21:45] [INFO] claude 완료: 850자 응답
```

`session=`은 user의 `claude_session_id` UUID 8자리 prefix입니다. 같은 유저는 매번 같은 prefix가 찍히고, `/clear` 후엔 새 prefix로 바뀝니다.

## 트러블슈팅

### 데몬이 시작되지 않을 때

```bash
# 수동으로 직접 실행하여 에러 확인
bun run ~/jarvis/packages/gateway-server/src/daemon.ts

# PID 파일이 남아있을 때
rm ~/.jarvis/daemon.pid
jarvis start
```

### launchd 문제

```bash
# 강제 재등록
jarvis uninstall
jarvis install
```

## 다음 단계

- [팀원 등록](04-team-members.md) — 페어링으로 팀원 추가
- [개발 워크플로우](05-dev-workflow.md) — `/dev` 커맨드
