---
name: jarvis-telegram
description: "Telegram 채널을 통한 Jarvis 요청을 처리합니다. <channel source=\"telegram\"> 태그가 감지되면 자동으로 활성화되어 인증, 권한 체크, 메시지 라우팅을 수행합니다. /jarvis-telegram으로 수동 호출도 가능합니다."
---

# Jarvis Telegram 채널 처리기

## 트리거

`<channel source="telegram" ...>` 태그가 포함된 메시지가 도착하면 이 스킬이 활성화됩니다.

## 처리 절차

### Step 1: 메시지 파싱

`<channel>` 태그에서 다음 정보를 추출합니다:
- `chat_id` — Telegram 채팅방 ID
- `message_id` — 메시지 ID
- `user` — 발신자 이름
- 메시지 본문

**유저 ID 규칙**: `telegram:{chat_id}` 형식으로 식별

### Step 2: 게이트웨이 라우팅

`jarvis_gateway_route` MCP 도구를 호출합니다:

```
jarvis_gateway_route(
  channel: "telegram",
  user_id: "telegram:{chat_id}",
  display_name: "{user}",
  message: "{메시지 본문}",
  message_id: "{message_id}",
  chat_id: "{chat_id}"
)
```

### Step 3: 결과 처리

라우팅 결과의 `action`에 따라 분기합니다:

#### `pairing_required` — 미인증 유저
게이트웨이가 생성한 페어링 안내 메시지를 Telegram으로 전송:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{페어링 안내 메시지}"
)
```

#### `permission_denied` — 권한 부족
거부 메시지를 Telegram으로 전송:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{권한 부족 메시지}"
)
```

#### `respond` — 시스템 커맨드 응답
즉시 응답 메시지를 전송:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{응답 메시지}"
)
```

#### `execute` — 일반 요청 처리

1. 유저의 프로필과 개인화 설정을 확인합니다
2. 프로필 권한에 따라 요청을 처리합니다:
   - **observer**: 질문/검색만 가능 → 코드를 읽고 답변만 생성
   - **reviewer**: 읽기 + 분석 → 코드 분석, PR 리뷰 결과 생성
   - **developer**: 읽기/쓰기 → 코드 수정 가능 (sandbox 환경)
   - **admin**: 전체 접근
3. 개인화 설정(tone, language, verbosity)에 맞게 응답을 생성합니다
4. 결과를 Telegram으로 전송:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{처리 결과}"
)
```

### Step 4: 크론잡 처리

메시지가 `/cron` 커맨드인 경우, 라우팅 결과의 response에 크론 액션이 포함됩니다:

```json
{"action": "cron_add", "args": {"prompt": "매일 9시 할 일 정리"}}
```

이 경우 `jarvis_cron_manage` MCP 도구를 호출하고 결과를 Telegram으로 전송합니다.

## 페어링 승인 (Owner만)

Owner가 터미널에서 페어링을 승인하는 방법:

```
/jarvis-telegram pair list     → 대기 중인 페어링 목록
/jarvis-telegram pair approve {코드} {프로필}  → 승인
/jarvis-telegram pair reject {유저ID}  → 거부
```

이때 `jarvis_gateway_pair` MCP 도구를 사용합니다.

## 서브 커맨드

```
/jarvis-telegram status    → 채널 상태
/jarvis-telegram pair list → 페어링 목록
/jarvis-telegram pair approve {코드} developer → 승인
/jarvis-telegram pair reject {유저ID} → 거부
```

## MCP 도구 의존성
- `jarvis_gateway_route` — 메시지 라우팅
- `jarvis_gateway_pair` — 페어링 관리
- `jarvis_gateway_send` — 메시지 전송
- `jarvis_cron_manage` — 크론잡 관리
- `jarvis_sandbox_config` — 샌드박스 설정
- `mcp__plugin_telegram_telegram__reply` — Telegram 메시지 전송
- `mcp__plugin_telegram_telegram__react` — Telegram 이모지 반응
