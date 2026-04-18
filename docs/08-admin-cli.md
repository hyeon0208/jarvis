# 관리 CLI

Owner가 터미널에서 Jarvis를 운영할 때 쓰는 명령어들입니다.
프로필/프로젝트/채널/유저 모두 **파일 편집 없이 명령 한 줄로 관리**할 수 있습니다.

---

## 목차

1. [페어링 관리 (jarvis pair)](#1-페어링-관리-jarvis-pair)
2. [조회 (jarvis list)](#2-조회-jarvis-list)
3. [진단 (jarvis doctor)](#3-진단-jarvis-doctor)
4. [프로젝트 CRUD (jarvis project)](#4-프로젝트-crud-jarvis-project)
5. [채널 CRUD (jarvis channel)](#5-채널-crud-jarvis-channel)
6. [유저 관리 (jarvis user)](#6-유저-관리-jarvis-user)
7. [마법사 (edit-profile / add-project / add-channel)](#7-마법사)
8. [Claude Code 설정 자동 패치 (jarvis install-mcp)](#8-claude-code-설정-자동-패치-jarvis-install-mcp)
9. [데몬 자동 진단](#9-데몬-자동-진단)

---

## 1. 페어링 관리 (jarvis pair)

팀원이 Telegram 봇에 메시지를 보내면 페어링 코드가 발급됩니다. Owner가 터미널에서 바로 승인/거부할 수 있습니다.

```bash
jarvis pair list                          # 대기 중인 페어링 목록
jarvis pair approve <code> [profile]      # 승인 (기본: observer)
jarvis pair reject <user_id>              # 거부
```

**예시:**

```bash
$ jarvis pair list
대기 중인 페어링 (1건):

  A1B2C3  telegram  김철수
    user_id: telegram:123456789
    만료: 2026-04-20 15:30:00

$ jarvis pair approve A1B2C3 developer
승인 완료
  user_id: telegram:123456789
  profile: developer
```

**이전 방식**: `jarvis chat` 진입 → `/jarvis-telegram pair approve ...` 입력 (2단계)
**현재 방식**: `jarvis pair approve A1B2C3 developer` (1줄)

---

## 2. 조회 (jarvis list)

```bash
jarvis list profiles      # profiles.yml 정의 목록
jarvis list users         # 등록된 유저 (페어링 상태, 프로필 포함)
jarvis list channels      # 채널 상태 + 토큰 존재 여부
jarvis list pending       # 페어링 대기 (= pair list)
```

**예시:**

```bash
$ jarvis list profiles
프로필 목록 (4개):

  [skip_permissions] admin
    설명: 전체 관리자
    모델: (기본값) / effort: high / 도구: 0개
    타임아웃: 600초

  developer
    설명: 개발자 — 코드 읽기/쓰기, git, 테스트 실행
    모델: (기본값) / effort: xhigh / 도구: 37개
    타임아웃: 300초
  ...

$ jarvis list channels
채널 목록 (4개):

  ● 활성  telegram  토큰 OK
  ○ 비활성  discord  토큰 누락: DISCORD_BOT_TOKEN
  ○ 비활성  slack    토큰 누락: SLACK_BOT_TOKEN, SLACK_APP_TOKEN
```

---

## 3. 진단 (jarvis doctor)

11개 항목을 자동 체크합니다.

```bash
jarvis doctor                  # 전체 진단 (토큰 라이브 검증 포함)
jarvis doctor --quick          # 네트워크 제외 (빠른 체크)
jarvis doctor --skip-network   # --quick과 동일
```

**체크 항목:**

| # | 항목 | FAIL 시 힌트 |
|---|------|------------|
| 1-3 | 디렉토리 존재 (`~/.jarvis/data`, `users`, `~/jarvis/config`) | `mkdir -p` 명령 |
| 4 | profiles.yml 파싱 | YAML 문법 오류 위치 |
| 5 | channels.yml 파싱 | YAML 문법 오류 |
| 6 | projects.jsonc 파싱 | JSON 파싱 오류 |
| 7 | projects 스키마 (path 존재, allowed_profiles 유효) | 경로 수정 또는 프로필 추가 |
| 8 | 채널 토큰 매칭 (enabled 채널의 env 키) | `jarvis channel token ...` |
| 9 | 토큰 라이브 검증 (Telegram `getMe`) | 토큰 재발급 안내 |
| 10 | 데몬 상태 (PID 파일 + 프로세스) | `jarvis start` |
| 11 | MCP 서버 등록 (settings.json) | `jarvis install-mcp` |
| 12 | jarvis 글로벌 명령 심볼릭 링크 | `setup.sh` 재실행 |

**예시:**

```bash
$ jarvis doctor --quick
Jarvis 진단 시작 (네트워크 제외)

  ✓  데이터 디렉토리: /Users/hyeonjun/.jarvis/data
  ✓  유저 디렉토리: /Users/hyeonjun/.jarvis/users
  ✓  profiles.yml 파싱: 4개 프로필
  ✓  projects 스키마: 모든 참조 유효
  ✓  채널 토큰: 활성 채널 토큰 모두 있음
  ✓  데몬 상태: 실행 중 (PID 1418)
  ✓  MCP 서버 등록: jarvis-memory, jarvis-gateway
  ⚠  jarvis 글로벌 명령: 심볼릭 링크 없음
      힌트: setup.sh를 재실행하세요

결과: OK 10 / WARN 1 / FAIL 0
```

FAIL이 있으면 종료 코드 1, 없으면 0을 반환합니다. CI/cron에서 활용 가능합니다.

---

## 4. 프로젝트 CRUD (jarvis project)

`config/projects.jsonc`를 명령으로 수정합니다.

```bash
jarvis project ls
jarvis project add <key> --path <p> --repo <r> --profiles <a,b> [--branch dev] [--prefix feature]
jarvis project rm <key>
```

**예시:**

```bash
$ jarvis project add backend \
    --path ~/Desktop/backend \
    --repo myorg/backend \
    --profiles admin,developer \
    --branch dev \
    --prefix feature

프로젝트 추가됨: backend
```

인터랙티브 마법사는 `jarvis add-project` 참고.

---

## 5. 채널 CRUD (jarvis channel)

```bash
jarvis channel ls
jarvis channel enable <name>        # channels.yml의 enabled: true
jarvis channel disable <name>       # enabled: false
jarvis channel token <name> <value> # .env에 해당 채널의 token_env 키 upsert
```

**예시:**

```bash
$ jarvis channel token discord MTIzNDU2...
.env 업데이트: DISCORD_BOT_TOKEN
활성화하려면: jarvis channel enable discord

$ jarvis channel enable discord
discord 활성화됨
```

Slack은 bot-token + app-token이 분리되어 있어 `jarvis add-channel` 마법사를 사용하거나 `.env` 직접 편집 권장.

---

## 6. 유저 관리 (jarvis user)

`~/.jarvis/users/*.json`의 유저 설정을 직접 관리합니다.

```bash
jarvis user ls
jarvis user show <user_id>
jarvis user profile <user_id> <profile>   # 프로필 변경
jarvis user rename <user_id> <new_name>   # 이름 변경
jarvis user rm <user_id>                  # 삭제
```

**예시:**

```bash
$ jarvis user profile telegram:123456789 reviewer
telegram:123456789 → 프로필 변경: reviewer
```

변경은 **즉시 반영**됩니다 (데몬 재시작 불필요 — permissions.ts의 핫 리로드).

---

## 7. 마법사

인터랙티브하게 설정하고 싶을 때 사용합니다.

### 7.1 프로필 생성 (기존)

```bash
jarvis create-profile
```

### 7.2 기존 프로필 수정 (신규)

```bash
jarvis edit-profile <name>
```

각 항목이 `[현재값]`과 함께 표시되며, 빈 입력 시 기존 값 유지. 도구 목록은 "추가/제거/전체 재입력" 중 선택.

**예시:**

```
현재 모델: (기본값)
모델을(를) 변경할까요? (현재 유지하려면 마지막 항목)
  1. opus   — 강력, 복잡한 코딩/설계
  2. sonnet — 균형
  3. haiku  — 빠르고 저렴
  4. 현재 유지

현재 allowed_tools (37개):
  - Read
  - Glob
  - ...
allowed_tools을(를) 어떻게 수정할까요?
  1. 현재 유지
  2. 항목 추가
  3. 항목 제거
  4. 전체 재입력 (쉼표 구분)
```

### 7.3 프로젝트 추가 (신규)

```bash
jarvis add-project
```

- 경로 입력 시 존재하지 않으면 자동 생성 제안
- 접근 가능 프로필을 `profiles.yml`에서 읽어 번호 선택
- 확인 후 `projects.jsonc`에 저장 (헤더 주석 보존)

### 7.4 채널 추가 (신규)

```bash
jarvis add-channel
```

- 채널 종류 선택 (telegram/discord/slack/webhook)
- 토큰 입력 → `.env`에 자동 저장
- Telegram인 경우 **토큰 라이브 검증** (getMe API 호출 → 봇 username 확인)
- 확인 후 `channels.yml` 활성화

---

## 8. Claude Code 설정 자동 패치 (jarvis install-mcp)

`~/.claude/settings.json`에 Jarvis MCP 서버, 권한, 훅을 **idempotent하게** 머지합니다.

```bash
jarvis install-mcp              # 실제 적용 (타임스탬프 백업 파일 생성)
jarvis install-mcp --dry-run    # 변경사항 미리보기만
```

**자동 적용 항목:**

| 섹션 | 항목 |
|------|------|
| `mcpServers` | `jarvis-memory`, `jarvis-gateway` |
| `permissions.allow` | 19개 MCP 도구 전체 (`mcp__jarvis-*`) |
| `hooks.PostToolUse` | auto-memory.js, skill-nudge.js |

**idempotent 동작:**

```bash
$ jarvis install-mcp
추가될 항목 (1):
  + permissions.allow[mcp__jarvis-gateway__jarvis_worktree_manage]

이미 존재 (유지): 21개

패치 완료 (1개 변경)
백업: /Users/hyeonjun/.claude/settings.json.bak.2026-04-18T16-19-25-022Z
Claude Code를 재시작해야 MCP 서버가 로드됩니다.
```

**예전 방식**: `setup.sh`가 수동 설정 안내만 출력 → 사용자가 직접 JSON 편집
**현재 방식**: `setup.sh`가 `jarvis install-mcp` 자동 호출

---

## 9. 데몬 자동 진단

데몬 시작 시 설정 오류를 감지하면 **시작이 거부**됩니다.

```bash
$ jarvis start
Jarvis Daemon 시작 중...
```

```bash
# 문제가 있는 경우 (예: profiles.yml 삭제)
$ cat ~/.jarvis/daemon.log | tail -5
[ERROR] 설정 오류로 데몬을 시작할 수 없습니다. `jarvis doctor`로 확인하세요.
[ERROR]   ✗ profiles.yml 파일: 파일이 없습니다
[ERROR]   ✗ project[backend].allowed_profiles: 존재하지 않는 프로필 참조: admin
[ERROR] 우회하려면 JARVIS_SKIP_DOCTOR=1 환경변수를 설정하세요.
```

**체크 항목** (빠른 체크, 네트워크 제외):
- profiles.yml 파일/문법
- channels.yml 파일/문법
- projects.jsonc 파일/문법
- projects 스키마 (경로 + 프로필 참조)
- 활성 채널의 토큰 env 키 존재

**우회 방법** (디버깅 시):

```bash
JARVIS_SKIP_DOCTOR=1 jarvis start
```

종료 코드:
- `0`: 정상
- `2`: 진단 실패로 시작 거부

---

## 설정 파일 관계

명령어와 설정 파일의 매핑:

```
profiles.yml ─── jarvis create-profile / edit-profile / list profiles
projects.jsonc ── jarvis project / add-project / list profiles
channels.yml ──── jarvis channel / add-channel / list channels
.env ──────────── jarvis channel token / add-channel
~/.jarvis/users/ ─ jarvis user / pair / list users
~/.claude/settings.json ─ jarvis install-mcp
```

모든 명령은 **백업 파일**을 자동 생성합니다 (`.bak.{ISO timestamp}`).

## 신규 유저 등록 전체 흐름 (예시)

```bash
# 1. 팀원이 봇에 메시지 보내면 페어링 코드 발급
#    (자동)

# 2. Owner가 터미널에서 코드 확인
$ jarvis pair list

# 3. 프로필 지정하여 승인
$ jarvis pair approve A1B2C3 developer

# 4. 등록 확인
$ jarvis user show telegram:123456789

# 5. 나중에 프로필 변경 (예: developer → reviewer)
$ jarvis user profile telegram:123456789 reviewer
```

---

## 다음 단계

- [커맨드 레퍼런스](07-commands.md) — 전체 명령어 목록
- [팀원 등록](04-team-members.md) — 페어링 상세
