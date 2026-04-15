import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DATA_DIR = join(process.env.HOME ?? "~", ".jarvis", "data");
const USERS_DIR = join(process.env.HOME ?? "~", ".jarvis", "users");
const PAIRING_FILE = join(DATA_DIR, "pending-pairings.json");

export interface PairingRequest {
  user_id: string;
  channel: string;
  code: string;
  display_name: string;
  requested_at: string;
  expires_at: string;
}

function ensureDirs(): void {
  for (const dir of [DATA_DIR, USERS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** 6자리 페어링 코드 생성 */
function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

/** 대기 중인 페어링 요청 로드 */
function loadPendingPairings(): PairingRequest[] {
  ensureDirs();
  if (!existsSync(PAIRING_FILE)) return [];
  try {
    return JSON.parse(readFileSync(PAIRING_FILE, "utf-8"));
  } catch {
    return [];
  }
}

/** 대기 중인 페어링 요청 저장 */
function savePendingPairings(pairings: PairingRequest[]): void {
  ensureDirs();
  writeFileSync(PAIRING_FILE, JSON.stringify(pairings, null, 2));
}

/** 유저 설정 파일 경로 */
function userFilePath(userId: string): string {
  // 파일명에 안전한 문자만 사용
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(USERS_DIR, `${safeId}.json`);
}

/** 유저가 페어링(인증)되었는지 확인 */
export function isUserPaired(userId: string): boolean {
  const filePath = userFilePath(userId);
  if (!existsSync(filePath)) return false;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.paired === true;
  } catch {
    return false;
  }
}

/** 새 페어링 요청 생성 (알 수 없는 발신자가 메시지를 보낼 때) */
export function createPairingRequest(
  userId: string,
  channel: string,
  displayName: string,
): PairingRequest {
  const pairings = loadPendingPairings();

  // 기존 요청이 있으면 제거
  const filtered = pairings.filter((p) => p.user_id !== userId);

  const request: PairingRequest = {
    user_id: userId,
    channel,
    code: generateCode(),
    display_name: displayName,
    requested_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24시간
  };

  filtered.push(request);
  savePendingPairings(filtered);
  return request;
}

/** 페어링 코드 검증 및 승인 */
export function approvePairing(
  code: string,
  profile = "observer",
): { success: boolean; userId?: string; error?: string } {
  const pairings = loadPendingPairings();
  const index = pairings.findIndex((p) => p.code === code);

  if (index === -1) {
    return { success: false, error: "유효하지 않은 페어링 코드입니다" };
  }

  const request = pairings[index];

  // 만료 확인
  if (new Date(request.expires_at) < new Date()) {
    pairings.splice(index, 1);
    savePendingPairings(pairings);
    return { success: false, error: "만료된 페어링 코드입니다" };
  }

  // 유저 파일 생성
  ensureDirs();
  const userData = {
    user_id: request.user_id,
    name: request.display_name,
    profile,
    channel: request.channel,
    paired: true,
    paired_at: new Date().toISOString(),
    personality: {
      tone: "friendly",
      language: "ko",
      verbosity: "normal",
      emoji: false,
      nickname: "Jarvis",
    },
    cron_jobs: [],
  };

  writeFileSync(userFilePath(request.user_id), JSON.stringify(userData, null, 2));

  // 대기 목록에서 제거
  pairings.splice(index, 1);
  savePendingPairings(pairings);

  return { success: true, userId: request.user_id };
}

/** 대기 중인 페어링 요청 목록 */
export function listPendingPairings(): PairingRequest[] {
  const pairings = loadPendingPairings();
  const now = new Date();
  // 만료된 것 필터
  return pairings.filter((p) => new Date(p.expires_at) > now);
}

/** 페어링 거부 */
export function rejectPairing(userId: string): boolean {
  const pairings = loadPendingPairings();
  const filtered = pairings.filter((p) => p.user_id !== userId);
  if (filtered.length === pairings.length) return false;
  savePendingPairings(filtered);
  return true;
}

/** 유저 설정 로드 */
export function loadUserConfig(userId: string): Record<string, unknown> | null {
  const filePath = userFilePath(userId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** 유저 설정 업데이트 */
export function updateUserConfig(
  userId: string,
  updates: Record<string, unknown>,
): boolean {
  const current = loadUserConfig(userId);
  if (!current) return false;
  const merged = { ...current, ...updates };
  writeFileSync(userFilePath(userId), JSON.stringify(merged, null, 2));
  return true;
}
