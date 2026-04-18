/**
 * 마법사 공용 프롬프트 헬퍼
 *
 * Bun의 `console` AsyncIterable로 사용자 입력을 받습니다.
 * create-profile.ts, edit-profile.ts, add-project.ts 등에서 재사용합니다.
 */

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/** 한 줄 입력 */
export async function ask(question: string): Promise<string> {
  process.stdout.write(`${CYAN}${question}${RESET} `);
  for await (const line of console) {
    return line.trim();
  }
  return "";
}

/** 기존 값이 있는 항목을 수정할 때: 빈 입력이면 기존 값 유지 */
export async function askPatch(label: string, current: string): Promise<string> {
  const input = await ask(`${label} [${current}]:`);
  return input || current;
}

/** Yes/No */
export async function askYesNo(question: string): Promise<boolean> {
  const answer = await ask(`${question} (y/n):`);
  return answer.toLowerCase().startsWith("y");
}

/** 번호 선택 (단일) */
export async function askChoice(question: string, options: string[]): Promise<number> {
  console.log(`\n${CYAN}${question}${RESET}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  const answer = await ask("번호:");
  const index = Number(answer) - 1;
  if (isValidChoice(index, options.length)) return index;
  console.log(`${YELLOW}잘못된 번호입니다. 다시 선택하세요.${RESET}`);
  return askChoice(question, options);
}

/** 번호 선택 (복수, 쉼표 구분) */
export async function askMultiChoice(question: string, options: string[]): Promise<number[]> {
  console.log(`\n${CYAN}${question}${RESET} (쉼표로 여러 개 선택, 예: 1,3,5)`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  const answer = await ask("번호:");
  const indices = answer
    .split(",")
    .map((s) => Number(s.trim()) - 1)
    .filter((i) => isValidChoice(i, options.length));
  if (indices.length > 0) return indices;
  console.log(`${YELLOW}최소 1개를 선택하세요.${RESET}`);
  return askMultiChoice(question, options);
}

function isValidChoice(index: number, total: number): boolean {
  if (Number.isNaN(index)) return false;
  if (index < 0) return false;
  if (index >= total) return false;
  return true;
}
