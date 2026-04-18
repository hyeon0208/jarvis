/**
 * 채널 어댑터 공통 인터페이스
 *
 * 새 채널을 추가하려면:
 * 1. 이 인터페이스를 구현한 어댑터 생성 (예: adapters/whatsapp.ts)
 * 2. registry.ts에 등록
 * 3. channels.yml에 활성화 설정 추가
 */

export type ChannelKind =
  | "telegram"
  | "discord"
  | "slack"
  | "webhook"
  | "email"
  | string; // 사용자 정의 어댑터 허용

/** 외부 채널에서 들어온 메시지 (정규화됨) */
export interface AdapterIncoming {
  /** 채널 종류 */
  channel: ChannelKind;
  /** Jarvis 유저 ID 형식: "{channel}:{external_id}" */
  user_id: string;
  /** 발신자 표시 이름 */
  display_name: string;
  /** 메시지 본문 */
  message: string;
  /** 메시지 ID (응답 시 reply target으로 사용) */
  message_id?: string;
  /** 채팅방/채널 ID (응답 보낼 곳) */
  chat_id?: string;
  /** 추가 컨텍스트 (스레드 ID, 멘션 정보 등 채널별 데이터) */
  meta?: Record<string, unknown>;
}

/** 채널로 응답을 보낼 때 필요한 정보 */
export interface AdapterOutgoing {
  /** 채팅방/채널 ID */
  chat_id: string;
  /** 응답할 원본 메시지 ID (스레드/리플라이용) */
  reply_to?: string;
  /** 메시지 본문 */
  message: string;
  /** 추가 옵션 (스레드 응답 여부 등) */
  meta?: Record<string, unknown>;
}

/** 모든 채널 어댑터가 구현해야 하는 인터페이스 */
export interface ChannelAdapter {
  /** 채널 식별자 */
  readonly name: ChannelKind;

  /** 활성화 여부 (환경 변수, 토큰 등 검증) */
  isAvailable(): boolean;

  /** 메시지 수신 시작. onMessage 콜백을 통해 daemon에 전달 */
  start(onMessage: (msg: AdapterIncoming) => Promise<string | null>): Promise<void>;

  /** 메시지 전송 (응답) */
  send(out: AdapterOutgoing): Promise<void>;

  /** 봇 커맨드 메뉴 등록 (Telegram setMyCommands 등 — 채널이 지원하지 않으면 no-op) */
  registerCommands?(commands: Array<{ command: string; description: string }>): Promise<void>;

  /** 종료 정리 */
  stop?(): Promise<void>;
}

/** 어댑터 설정 (channels.yml의 각 채널 항목) */
export interface ChannelAdapterConfig {
  enabled: boolean;
  /** 채널별 추가 설정 (토큰, polling interval 등) */
  [key: string]: unknown;
}
