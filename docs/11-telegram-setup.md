# Telegram 채널 설정

> **봇은 데몬을 운영하는 사람(Owner) 1명이 1개만 만듭니다.** 그 봇 1개로 본인과 모든 팀원이 동시에 접근합니다 — 팀원 각자가 봇을 만들 필요는 없습니다. (Anthropic이 운영하는 공용 Jarvis 봇은 없으므로, 데몬 운영자가 직접 봇 토큰을 발급받아 자기 머신에 등록해야 합니다.)
> Slack/Discord도 같은 패턴입니다 — [10. Slack 채널 설정](10-slack-setup.md) 참고.

---

## 사전 정보

- **상호작용은 1:1 DM만**. Telegram에는 "봇을 워크스페이스/서버에 추가" 개념이 없습니다 — 사용자가 봇 username을 검색해서 각자 1:1 채팅을 시작하는 구조 (그룹채팅 봇은 가능하지만 Jarvis는 DM 전용으로 동작).
- **봇 1개 = 데몬 인스턴스 1개**. 그 봇으로 **여러 팀원이 동시에** Jarvis 사용 가능 (각자 별도 1:1 채팅).
- 각 팀원의 메시지는 Telegram `chat_id`로 자동 식별 → user_id `telegram:{chat_id}`로 분리 처리
- 통신 방식: **long polling** (데몬이 Telegram 서버에 1초마다 "새 메시지 있어?" 질의)
- 외부 포트 오픈 불필요
- 구현 코드: [`packages/gateway-server/src/adapters/telegram.ts`](../packages/gateway-server/src/adapters/telegram.ts)
- 메시지 격리: 자동 — 모든 Telegram 유저는 `telegram:{chat_id}` user_id로 메모리/대화/디렉토리가 분리됩니다 ([06-memory.md#사용자별-메모리-격리](06-memory.md#사용자별-메모리-격리))

> Slack/Discord는 다릅니다 — 워크스페이스/서버에 봇이 추가되면 DM뿐 아니라 **채널에서 `@봇` 멘션도 가능** (1:N). 자세히는 [10. Slack 채널 설정](10-slack-setup.md) 참고.

---

## 1. BotFather에서 봇 생성

1. Telegram 앱에서 [@BotFather](https://t.me/BotFather) 검색 → 대화 시작
2. `/newbot` 명령 전송
3. **봇 표시 이름** 입력 (예: `My Jarvis`) — 자유롭게
4. **봇 username** 입력 (예: `my_jarvis_bot`) — `_bot`으로 끝나야 함, 전 세계 유니크
5. BotFather가 **Bot Token**을 줍니다 (예: `1234567890:ABCdef...`) → 다음 단계에서 사용

> 토큰은 비밀번호와 같습니다. **공유 금지** (`.env`는 gitignore됨, 안전).

## 2. (옵션) 봇 메뉴 명령 등록

BotFather에서 `/setcommands` → 봇 선택 → 다음 텍스트 붙여넣기:

```
help - 사용 가능한 명령 목록
status - Jarvis 상태 확인
profile - 내 프로필 조회
personality - 개인화 설정 조회
clear - 대화 컨텍스트 초기화
dev - 개발 워크플로우 시작
cron - 크론잡 관리
```

이러면 봇 채팅에서 `/`만 입력해도 자동완성 메뉴가 뜹니다.

> Jarvis 데몬은 시작 시 자동으로 위 명령을 등록하므로 이 단계는 보통 생략 가능합니다.

## 3. 토큰을 Jarvis에 등록

```bash
jarvis channel token telegram 1234567890:ABCdef-여기에-실제-토큰
# → ~/jarvis/.env에 TELEGRAM_BOT_TOKEN= 자동 추가
```

또는 `~/jarvis/.env`를 직접 편집:

```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
```

## 4. 채널 활성화 + 데몬 시작

```bash
jarvis channel enable telegram   # channels.yml의 telegram.enabled = true
jarvis start                     # 데몬 기동 (또는 jarvis restart)
jarvis logs 30                   # "Telegram 리스너 활성화됨" 로그 확인
```

## 5. 토큰 라이브 검증

```bash
jarvis doctor                    # Telegram 토큰 라이브 체크 (getMe API 호출)
```

> 정상이면 `✓ Telegram 토큰: @your_bot_username` 출력. 실패면 토큰이 잘못되었거나 revoke됨.

## 6. 본인 페어링 (Owner)

이제 Telegram에서 본인이 만든 봇과 1:1 대화를 시작합니다.

1. Telegram 앱 → 검색창에 본인이 만든 봇 username 입력 (예: `@my_jarvis_bot`)
2. **Start** 버튼 클릭
3. 아무 메시지 전송 (예: "안녕")
4. 봇이 페어링 코드 발급:

```
안녕하세요 hyeonjun님! Jarvis를 사용하려면 페어링이 필요합니다.

페어링 코드: A1B2C3

관리자에게 이 코드를 전달하세요. 코드는 24시간 후 만료됩니다.
```

5. 터미널에서 본인을 owner 프로필로 승인:

```bash
jarvis pair list                       # 대기 코드 확인
jarvis pair approve A1B2C3 owner       # 본인은 owner 프로필
```

6. 다시 Telegram에서 메시지를 보내면 즉시 Jarvis가 응답합니다.

---

## 팀원 추가 (선택)

봇은 그대로 1개 — 팀원이 같은 봇과 대화하면 됩니다 (각 팀원의 Telegram chat_id가 자동으로 다른 user_id로 매핑됨):

1. 팀원에게 봇 username (`@my_jarvis_bot`)을 공유
2. 팀원이 **자기 Telegram에서** 그 봇과 대화 시작 → 페어링 코드 발급받음
3. 팀원이 코드를 Owner(본인)에게 전달 (카톡/슬랙 등으로)
4. Owner 터미널에서 팀원 프로필 지정해서 승인:

```bash
jarvis pair list                          # 팀원 대기 코드 확인
jarvis pair approve B4C5D6 developer      # 코드 + 프로필
```

승인 명령에서 프로필을 다르게 줘서 권한 차등:

| 프로필 | 권한 |
|--------|------|
| `owner` | 전체 (**본인 전용**, 팀원에게 절대 부여 금지) |
| `developer` | 코드 읽기/쓰기 + git + 빌드/테스트 |
| `reviewer` | 코드 읽기 + git 조회 (수정 불가) |
| `observer` | WebSearch + 메모리 검색만 (로컬 파일 X) |

상세: [04. 팀원 등록/관리](04-team-members.md), [02. 보안 계층](02-architecture.md#보안-계층)

---

## 메모리/대화 격리 확인

본인과 팀원의 메모리·대화는 자동 분리됩니다 (`telegram:{chat_id}` 단위).

```
jarvis_memory_stats
```

응답의 `per_user_sessions` / `per_user_declarative` 항목에서 `telegram:1234567890` 같은 user별 row 수를 확인할 수 있습니다.

대화 컨텍스트 초기화는 채널에서 직접:

```
/clear
```

---

## 문제 해결

| 증상 | 확인 사항 |
|------|---------|
| 봇이 응답 없음 | `jarvis logs`에서 "Telegram 리스너 활성화됨" 줄이 있는지 |
| `Unauthorized` 에러 | `TELEGRAM_BOT_TOKEN`이 잘못됨 또는 revoke됨 — BotFather에서 재발급 |
| 페어링 코드만 계속 나옴 | `jarvis pair list`에 코드가 있는지 → `jarvis pair approve` 안 함 |
| 폴링 너무 느림 | `~/jarvis/config/channels.yml`의 `telegram.poll_interval_ms`(기본 1000) 조정 |
| 동시에 두 데몬 실행 시 충돌 | 같은 봇 토큰을 다른 머신에서 동시 polling하면 안 됨. 한 곳만 |
| 응답에 `**bold**`나 `# heading`이 그대로 보임 | 데몬이 Telegram 채널에 한해 plain-text 출력 지침을 시스템 프롬프트로 자동 주입함 (`packages/gateway-server/src/daemon.ts` `CHANNEL_OUTPUT_RULES`). 별도 설정 불필요. 모델이 가끔 무시하면 `jarvis restart`로 세션 새로 시작 |

---

## 자주 묻는 질문

### Q. 팀원도 각자 봇을 만들어야 하나요?

**아니요.** Owner(데몬 운영자) 1명이 봇 1개를 만들면, **그 봇 1개로 본인과 모든 팀원이 동시에 사용**합니다. 팀원은 그저 봇 username을 받아 페어링만 하면 됩니다. Telegram이 각 유저의 메시지를 `chat_id`로 자동 구분해서 데몬에 전달하므로, 데몬은 user_id(`telegram:{chat_id}`) 단위로 라우팅·격리합니다.

### Q. 그럼 "Owner마다 봇이 다르다"는 건 무슨 뜻이었나요?

데몬을 **운영하는 조직/사람** 단위로 봇이 다릅니다. 예: A 회사가 자체 데몬을 돌리면 A의 Telegram 봇 1개로 A 팀원 전체가 사용, B 회사는 B의 Telegram 봇 1개로 B 팀원 전체가 사용 — A와 B는 별개. 같은 조직 안에서는 (한 플랫폼 기준) 봇 1개로 모두 충분합니다.

### Q. Telegram + Slack을 둘 다 쓰면 봇이 2개인가요?

네 — 플랫폼이 다르면 각 플랫폼에서 봇을 1개씩 만들어야 합니다. 예: Telegram + Slack 동시 운영 = Telegram 봇 1개 (BotFather) + Slack App 1개 (api.slack.com/apps). 데몬 1개가 두 봇 모두를 동시에 처리합니다 (`channels.yml`에서 둘 다 `enabled: true`).

### Q. 다른 사람이 만든 봇으로 페어링하면 안 되나요?

기술적으로 가능하지만 **그 봇 운영자의 머신을 거쳐 메시지가 처리**되므로, 그 사람이 모든 대화 내용을 볼 수 있습니다. 회사/조직이 직접 데몬을 운영하지 않고 신뢰하는 외부 봇에 의존하는 건 권장하지 않습니다.

### Q. 봇 username을 바꾸고 싶으면?

BotFather에서 `/setname` 또는 `/setusername` 명령으로 변경. 토큰은 그대로 유지.

### Q. 한 머신에서 여러 봇을 운영할 수 있나요?

같은 머신에서 여러 데몬 동시 실행은 권장하지 않습니다 (PID 파일/포트/세션 경로가 한 인스턴스 기준). 보통은 봇 1개로 충분 — 한 봇이 무한정 많은 chat_id의 메시지를 동시에 처리할 수 있고, user_id로 격리됩니다.

### Q. Slack/Discord와 동시에 쓸 수 있나요?

네 — 각 플랫폼에서 봇을 따로 1개씩 발급해서 토큰을 등록한 뒤 `channels.yml`에서 모두 `enabled: true`로 두면, 데몬 1개가 모든 플랫폼을 동시에 listening합니다. 예: Telegram 봇 1개 + Slack App 1개 + Discord 봇 1개. user_id가 `telegram:NNN` / `slack:UXXX` / `discord:NNN`으로 자동 분리되어 메모리/대화도 플랫폼·유저별로 격리됩니다.

---

## 다른 채널

- **[Slack](10-slack-setup.md)**: Socket Mode + Bot Token + App Token
- **Discord**: 같은 패턴 — `discord.com/developers/applications`에서 봇 생성 → `jarvis channel token discord <토큰>` + `jarvis channel enable discord`
- **Webhook**: HTTP POST 수신용 — `WEBHOOK_AUTH_TOKEN` 발급 후 `.env` 등록

---

## 다음 단계

- [04. 팀원 등록/관리](04-team-members.md) — 페어링 + 프로필 + 개인화 (Telegram 외에도 동일)
- [06. 메모리 시스템 — 사용자별 격리](06-memory.md#사용자별-메모리-격리) — 채널/유저별 메모리 분리
- [07. 커맨드 레퍼런스](07-commands.md) — `/clear`, `/dev`, `/cron` 등 채널 명령
