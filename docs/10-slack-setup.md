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

## 3. Bot Token Scopes (7개)

좌측 **OAuth & Permissions** → **Bot Token Scopes**에 추가:

| Scope | 용도 |
|-------|------|
| `chat:write` | 봇이 메시지 전송 |
| `im:history` | DM 메시지 읽기 |
| `im:read` | DM 채널 조회 |
| `im:write` | DM 시작 가능 |
| `app_mentions:read` | 채널에서 `@봇` 멘션 읽기 |
| `users:read` | 멤버 이름 → user ID 변환 (macho가 "땡칠이 멘션해" 같은 요청을 처리하기 위해) |
| `reactions:write` | 수신 ACK 이모지(`:thug-life:`) 부착 |

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

### DM (1:1) — 페어링 코드 방식

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

> DM은 1:1 대화이므로 개인에 맞는 프로필(developer/reviewer/macho 등)을 **수동 승인**으로 선택할 수 있어야 의미가 있습니다. 그래서 DM은 자동 페어링 대상에서 제외됩니다 (`auto_pair_scope: mention_only` 기본값).

### 채널 @멘션 — 자동 페어링 (페어링 코드 불필요)

`channels.yml`에서 `slack.auto_pair: true`가 기본값이므로, 공용 채널에서 `@Jarvis ...`로 멘션하는 순간 **페어링 코드 없이 즉시 `macho` 프로필로 자동 등록**되고 답변이 시작됩니다.

근거: 슬랙 워크스페이스 멤버십 자체가 이미 1차 게이트. 채널 멘션은 공용 공간이라 기본 제한 프로필(`macho` — 로컬 접근 X, 외부 검색/API/브라우저만)을 주는 것이 안전.

자동으로 등록된 유저는 `jarvis user ls`에서 `auto_paired: true` 표식으로 식별할 수 있고, 이후 `jarvis user profile <user_id> developer` 등으로 수동 승격이 가능합니다.

## 10. 채널에서 @멘션 받기

봇을 채널에 초대:

```
/invite @Jarvis
```

이후 `@Jarvis 질문 내용`으로 호출. 응답은 스레드에 달림 (`thread_replies: true` 기본).

**스레드 격리**: 채널 본문에 `@Jarvis`로 멘션하면 그 메시지를 루트로 한 스레드 안에만 답변이 달립니다. 기존 스레드 안에서 `@Jarvis`를 추가로 부르면 **그 스레드 안에서만** 답변이 이어집니다 — 채널 본문으로 튀어나오지 않습니다. 구현 근거: [`adapters/slack.ts:L110,L119`](../packages/gateway-server/src/adapters/slack.ts) — `app_mention` 이벤트가 `event.thread_ts ?? event.ts`로 스레드 ID를 확정한 뒤 `chat.postMessage({ thread_ts })`로 전송.

**스레드 세션 공유**: 공용 채널 스레드에서 `@Jarvis`를 부르면 Jarvis는 스레드 단위로 Claude 세션을 공유합니다. 같은 스레드에 참여한 여러 사람이 이어서 멘션하면 서로의 이전 질문/답변을 Jarvis가 맥락으로 참고합니다.

```
#backend 스레드
├─ 철수: @Jarvis 이 500 에러 원인이 뭐야?
│        → Jarvis: "TxManager 설정이 누락된 듯합니다..."
│
└─ 영희: @Jarvis 그러면 어떻게 고쳐?
         → Jarvis: "철수님께 말씀드린 TxManager 설정을 수정하면..." (이전 맥락 참조 ✅)
```

**개인 설정은 발화자별 유지**: 스레드 세션은 대화 맥락(단기 컨텍스트)만 공유하고, **프로필/권한/장기 메모리/personality/샌드박스**는 여전히 user_id 단위로 격리됩니다. 즉 철수가 owner 프로필, 영희가 developer 프로필로 페어링돼 있으면 같은 스레드에서도 각자의 권한과 말투로 답변합니다.

**DM은 기존 그대로**: 봇에 1:1 DM으로 보내는 메시지는 계속 user_id 단위 개인 세션입니다.

> 개인정보 노출 주의: 공용 스레드의 세션은 참여자가 공유합니다. 민감한 질문(비밀번호, 개인 기록 등)은 DM에서 하세요.

---

## 자동 페어링 설정 (channels.yml)

`config/channels.yml`의 `slack` 섹션:

```yaml
slack:
  auto_pair: true                    # 자동 페어링 활성화
  auto_pair_profile: macho           # 자동 등록 시 부여할 프로필 (미지정 → default_profile)
  auto_pair_scope: mention_only      # mention_only(기본) | all
```

- `auto_pair_scope: mention_only` — 채널 `@멘션`만 자동 등록, DM은 페어링 코드
- `auto_pair_scope: all` — DM도 자동 등록 (개인 프로필을 일괄로 할당해도 되는 소규모 팀용)
- `auto_pair: false` — 완전 수동 페어링 (모든 채널에서 코드 발급)

### 보안 주의

- 자동 페어링은 **워크스페이스 멤버 전원**을 한 번의 멘션으로 등록합니다. 퇴사자/외부 게스트가 있는 워크스페이스라면 `jarvis user ls | grep auto_paired`로 주기 점검 + `jarvis user rm <user_id>`로 정리.
- `auto_pair_profile`은 반드시 **제한 프로필**(로컬 접근이 없는 macho/observer)로 두세요. `owner`나 `developer`로 두면 워크스페이스에 있는 누구든 코드 편집 권한을 얻게 됩니다.

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
| 수신 이모지 반응 안 붙음 | OAuth Scope `reactions:write` 누락, 또는 워크스페이스에 `:thug-life:` 커스텀 이모지 없음. 로그의 `ack 반응 실패 … code=invalid_name` 확인 |
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
