# Slack 채널 설정

> Slack을 Jarvis 채널로 추가해 팀원이 Slack DM/멘션으로 Jarvis를 사용할 수 있게 만드는 절차입니다.
> Discord/Telegram도 같은 패턴이며, 추가 채널 가이드는 향후 동일 형식으로 보강합니다.

---

## 사전 정보

- Jarvis Slack 어댑터는 **Socket Mode**를 사용 → **외부 포트 오픈 불필요** (Telegram처럼 outgoing only)
- 구현 코드: [`packages/gateway-server/src/adapters/slack.ts`](../packages/gateway-server/src/adapters/slack.ts)
- 필요 환경변수 2개: `SLACK_BOT_TOKEN` (xoxb-...), `SLACK_APP_TOKEN` (xapp-...)
- 메시지 격리: 자동 — 모든 Slack 유저는 `slack:U07ABC...` user_id로 메모리가 분리됩니다 ([06-memory.md#사용자별-메모리-격리](06-memory.md#사용자별-메모리-격리))

---

## 1. Slack App 생성

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. 앱 이름: `Jarvis` (자유), 워크스페이스 선택

## 2. Socket Mode 활성화 + App Token 발급

1. 좌측 **Socket Mode** → **Enable Socket Mode = On**
2. 토큰 이름: `jarvis-app-token`, 스코프 `connections:write` 자동 부여
3. 발급된 **`xapp-`** 시작 토큰 복사 → 나중에 `SLACK_APP_TOKEN`으로 등록

## 3. Bot Token Scopes (4개)

좌측 **OAuth & Permissions** → **Bot Token Scopes**에 추가:

| Scope | 용도 |
|-------|------|
| `chat:write` | 봇이 메시지 전송 |
| `im:history` | DM 메시지 읽기 |
| `im:write` | DM 시작 가능 |
| `app_mentions:read` | 채널에서 `@봇` 멘션 읽기 |

## 4. Event Subscriptions (2개)

좌측 **Event Subscriptions** → **Enable Events = On**
**Subscribe to bot events**에 추가:

| Event | 용도 |
|-------|------|
| `message.im` | DM 메시지 수신 |
| `app_mention` | 채널 `@봇` 멘션 수신 |

> Socket Mode 사용 중이라 Request URL 칸은 회색 처리됩니다 (정상).

## 5. App을 워크스페이스에 설치

좌측 **Install App** → **Install to Workspace** → 권한 승인
설치 직후 발급된 **Bot User OAuth Token (`xoxb-`)** 복사 → 나중에 `SLACK_BOT_TOKEN`으로 등록

## 6. 토큰을 Jarvis에 등록

```bash
# Bot Token (xoxb-) — channel 명령으로 .env에 자동 등록
jarvis channel token slack xoxb-여기에-bot-token

# App Token (xapp-) — channels.yml의 app_token_env가 SLACK_APP_TOKEN이므로 직접 추가
echo 'SLACK_APP_TOKEN=xapp-여기에-app-token' >> ~/jarvis/.env
```

또는 `~/jarvis/.env`를 직접 편집해서 두 줄 모두 추가:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

## 7. 채널 활성화 + 데몬 재시작

```bash
jarvis channel enable slack    # channels.yml의 slack.enabled = true
jarvis restart                 # 데몬 재시작
jarvis logs 30                 # "Slack 리스너 활성화됨" 로그 확인
```

## 8. 토큰 라이브 검증

```bash
jarvis doctor                  # Slack 토큰까지 라이브 체크 (auth.test API 호출)
```

> 정상이면 `✓ Slack 토큰: @{워크스페이스명}` 출력. 실패면 토큰/Scope 점검.

## 9. 동작 확인

1. 본인 Slack에서 봇 검색 (앱 이름 `Jarvis`) → DM 시작
2. 아무 메시지 전송 (예: "안녕")
3. **첫 메시지는 페어링 코드 발급** — 코드를 받으면:
   ```bash
   jarvis pair list                      # 대기 코드 확인
   jarvis pair approve A1B2C3 owner      # 본인이면 owner 프로필 (로컬 전체 접근)
   jarvis pair approve A1B2C3 developer  # 팀원이면 developer 등
   jarvis pair approve A1B2C3 macho      # 외부 검색/API + "상남자" 페르소나 (로컬 접근 X)
   ```
4. 이후 DM부터는 즉시 Jarvis가 응답

## 10. 채널에서 @멘션 받기

봇을 채널에 초대:

```
/invite @Jarvis
```

이후 `@Jarvis 질문 내용`으로 호출. 응답은 스레드에 달림 (`thread_replies: true` 기본).

**스레드 격리**: 채널 본문에 `@Jarvis`로 멘션하면 그 메시지를 루트로 한 스레드 안에만 답변이 달립니다. 기존 스레드 안에서 `@Jarvis`를 추가로 부르면 **그 스레드 안에서만** 답변이 이어집니다 — 채널 본문으로 튀어나오지 않습니다. 구현 근거: [`adapters/slack.ts:L110,L119`](../packages/gateway-server/src/adapters/slack.ts) — `app_mention` 이벤트가 `event.thread_ts ?? event.ts`로 스레드 ID를 확정한 뒤 `chat.postMessage({ thread_ts })`로 전송.

---

## 메모리 격리 확인

방금 등록한 Slack 유저의 메모리는 자동으로 `slack:U07ABC...` user_id로 분리됩니다.
Claude Code 세션 또는 `jarvis chat`에서:

```
jarvis_memory_stats
```

응답의 `per_user_sessions` / `per_user_declarative` 항목에서 `slack:U...` 유저별 row 수를 확인할 수 있습니다.

---

## 문제 해결

| 증상 | 확인 사항 |
|------|---------|
| 봇이 응답 없음 | `jarvis logs`에서 "Slack 리스너 활성화됨" 줄이 있는지 |
| `not_authed` 에러 | `SLACK_BOT_TOKEN` 값이 잘못됨 또는 Scope 부족 |
| `socket mode disabled` | `SLACK_APP_TOKEN` 미설정/만료, 또는 Socket Mode가 Off |
| DM 안 받음 | OAuth Scopes에 `im:history` 누락 |
| 멘션 안 받음 | OAuth Scopes에 `app_mentions:read` 누락 또는 Event에 `app_mention` 미등록 |
| `jarvis doctor` Slack 항목 FAIL | 토큰 만료/revoke 또는 워크스페이스에서 앱 제거됨 |

---

## 다른 채널 (Discord / Webhook)

- **Discord**: 같은 패턴 — `jarvis channel token discord <토큰>` + `jarvis channel enable discord`. 봇 생성은 [discord.com/developers/applications](https://discord.com/developers/applications)
- **Webhook**: HTTP POST 수신용 — `WEBHOOK_AUTH_TOKEN` 발급 후 `.env` 등록 + `jarvis channel enable webhook`. 외부 시스템(GitHub Actions 등)에서 `Authorization: Bearer {token}` 헤더로 POST

---

## 다음 단계

- [04. 팀원 등록/관리](04-team-members.md) — 페어링 + 프로필 지정
- [06. 메모리 시스템](06-memory.md#사용자별-메모리-격리) — Slack 유저 메모리 격리 동작
- [07. 커맨드 레퍼런스](07-commands.md) — `jarvis channel`, `jarvis pair`, `jarvis doctor` 상세
