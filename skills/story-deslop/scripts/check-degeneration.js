#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const USAGE = `Usage: node check-degeneration.js [--check] [--json] [--fail-on=blocking|all] <file...>

Detect model-degeneration fingerprints that a degrading model cannot self-report:
  - verbatim repetition (복사 반복/소용돌이): 긴 문장이 반복되거나 연속된 동일한 줄
  - mid-sentence truncation (절단): 파일이 종료 부호나 마침 부호 없이 끝남
  - placeholder / refusal / meta leakage (메타정보 유출): AI로서 / 계속할 수 없습니다 / 여기서 생략 / 깨진 문자
  - engineering-word leakage (공학 용어 유출): 세부 계획 / 스토리 포인트 / 현재 장 / 다음 장 / 작업 설명이 본문에 섞임

Each finding carries severity: blocking (복사 반복/절단/자리표시자 거절 문구/tier1 순수 공학 용어, 본문에서 절대 허용 불가,
명중 시 재작성) 또는 advisory (tier2 장/의미 모호 단어, 대사 줄의 기술 용어는 제안만 하고 사람/LLM 판단)
--fail-on=blocking은 blocking 발견 시에만 종료 코드 1로 나감. 기본값 --fail-on=all은 어떤 발견이든 종료 코드 1로 나감

Report-only. The script never rewrites — the safe response is to regenerate the
영향받은 단위(장/요약)에 발견 결과를 제약으로 피드백하고, 재시도를 제한한 후
사용자에게 근거를 제시함. 보수적으로 설계됨: 통속적 네트워크 문학은 의도적으로
배비/복타/탄막 스팸/반복 대사를 리듬감 위해 사용하므로, 짧은 문장과 대사 반복은 제외함

// 반복: 긴 문장(보이는 글자 수 ≥ REPEAT_MIN_LEN)이 ≥ REPEAT_MIN_COUNT번 나타나면 맴도는 것으로 판정;
// 인접한 전체 줄 반복(보이는 글자 수 ≥ ADJACENT_MIN_LEN)은 즉시 루프로 판정. 짧은 문장/채팅/대사 도배는 제외.
const REPEAT_MIN_LEN = 12;
const REPEAT_MIN_COUNT = 3;
const ADJACENT_MIN_LEN = 8;

// hard = 모든 줄을 판정(본문에서는 절대 허용되지 않음); soft = 「대사가 아닌」서술 줄에서만 판정(캐릭터 대사에서는 허용될 수 있음,
// 예: 「죄송해요, 저는 당신의 요청을 받아드릴 수 없어요」는 정상 대사이지 모델 거부가 아님).
const PLACEHOLDER_PATTERNS = [
// 「AI로서」는 자기지시 위치(그 뒤에 끊김/나/할 수 없음… 또는 문말)에 있어야 하며, 「인공지능 시대의 산물」 같은 오보를 피해야 함
  // 복합명사; 대화행에 면제 적용(시스템 흐름/AI 동반자 주제의 AI 역할 대사 "AI로서 저는 당신을 보호하겠습니다"는 합법적 대화).
  // 모델 접미사(AI 언어모델/AI 어시스턴트/인공지능 언어모델/AI 모델/AI 대형모델)는 선택적으로 제거 가능해야 함: 그렇지 않으면 전방탐색 단언이 바로 뒤따름
  // "AI" 뒤에서 "어"/"조"/"모"가 보이는 경우, 가장 전형적인 퇴화 시작 전체 유형 누락(story_hook_core.js의
  // SOFT_PATTERNS / story_codex_hook.py의 _NET_SOFT_PATTERNS과 동일 의미).
  { re: /작为(一个)?(AI|人工智能|大?语言模型|智能助手|聊天助手)(?:语言模型|大?模型|助手|机器人)?(?=[，,。、；;：:！!？?\s）)」』"】]|나는|할 수 없다|못한다|방법이 없다|$)/, label: 'AI 자체참조 메타정보 유출', hard: false },
  { re: /�/, label: '깨진 문자(대체 문자 �)', hard: true },
  { re: /^(Sure|Certainly|Here'?s|As an AI|I (?:cannot|can't|am unable|apologize))/, label: '메타정보 유출(영문 AI 톤)', hard: true },
  { re: /[（(](여기|아래|이곳|다음 내용|후속)?\s*(생략|략)(하다|하다)?[^）)]{0,10}[）)]/, label: '자리 표시자(괄호 생략)', hard: true },
  { re: /(미완성|TODO|자리 표시자|placeholder)/, label: '자리 표시자', hard: true },
  { re: /나는(할 수 없다|못한다)(계속(쓰다|창작하다|생성하다|진행하다)|내용(을|을|정문)?|텍스트(을|을|정문)?|정문(을|을|정문)?|생성하다|창작하다|속편을 쓰다|완성하다(이것을|이것을)?(장|편|창작|요청))/, label: '메타정보 유출(생성 거부 표현)', hard: false },
];

// 엔지니어링 용어 누출(정문 메타데이터 스캔의 결정성 버전): 약한 모델이 작문 엔지니어링 용어를 정문에 누출시켜 몰입감을 파괴함
// (DeepSeek-v4 같은 모델은 대화에서 "다음 장으로 넘어갈 때가 되었다"는 식으로 노출됨). 누출 용어는 모델 자체로는 발견할 수 없고, 스크립트로 처리함.
// tier1 = 순수 작문 파이프라인 용어, 정문에서는 거의 합법적이지 않음; tier2 = 장 구조/중의성 단어, 캐릭터가 스토리 내에서
// 실제 읽기/논의 시 "제X장" 또는 스토리 내 시스템/인터페이스 용어는 예외임(report-only, 사람/LLM 판단).
const META_TIER1_RE = /세부 개요|플롯 포인트|권 개요|기능 태그|목표 감정|글자 수 목표|장 시작 훅|장 끝 훅/;
const META_TIER2_RE = /제[1-9][0-9]*장|본장|이번 장|이전 장|다음 장|이전 장|다음 장|이전 장|다음 장|전문|후문|복선|독자|작업설명/;

const options = { json: false, files: [], failOn: 'all' };

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--check') {
    // Accepted for symmetry with the other detectors; detection is always check-only.
  } else if (arg === '--json') {
    options.json = true;
  } else if (arg.startsWith('--fail-on=')) {
    const v = arg.slice('--fail-on='.length);
    if (v !== 'blocking' && v !== 'all') die(`--fail-on must be 'blocking' or 'all'`);
    options.failOn = v;
  } else if (arg === '-h' || arg === '--help') {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  } else if (arg.startsWith('-')) {
    die(`Unknown option: ${arg}`);
  } else {
    options.files.push(arg);
  }
}

if (options.files.length === 0) {
  die('No files provided');
}

let failed = false;
const allFindings = [];

for (const file of options.files) {
  const fullPath = path.resolve(file);
  let input;
  try {
    input = fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    failed = true;
    if (!options.json) console.error(`${file}: unable to read (${error.message})`);
    continue;
  }
  const findings = scanDocument(input).map((finding) => ({ file, ...finding }));
  allFindings.push(...findings);
}

if (options.json) {
  process.stdout.write(`${JSON.stringify({ findings: allFindings }, null, 2)}\n`);
} else {
  for (const f of allFindings) {
    console.log(`${f.file}:${f.line}:${f.column}: [${f.severity}] ${f.type}: ${f.message} (${f.excerpt})`);
  }
}

if (failed) process.exit(2);
// --fail-on=blocking 차단(blocking) 발견 시에만 1로 종료(권고사항은 보고만 함); 기본값 all은 「모든 발견 시 1」을 따름.
const hasBlocking = allFindings.some((f) => f.severity === 'blocking');
if (options.failOn === 'blocking' ? hasBlocking : allFindings.length > 0) process.exit(1);

function die(message) {
  console.error(message);
  console.error(USAGE.trimEnd());
  process.exit(2);
}

function scanDocument(input) {
  const lines = input.split(/\r?\n/);
  const content = []; // { text, trimmed, lineNo } for body lines outside front-matter/fences
  let fence = null;
  let inFrontMatter = hasYamlFrontMatter(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (inFrontMatter) {
      if (index > 0 && trimmed === '---') inFrontMatter = false;
      continue;
    }
    const fenceMarker = /^(?:`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (fenceMarker && trimmed[0] === fence) fence = null;
      continue;
    }
    if (fenceMarker) {
      fence = trimmed[0];
      continue;
    }
    content.push({ text: line, trimmed, lineNo: index + 1 });
  }

  const findings = [];
  findings.push(...findRepetition(content));
  findings.push(...findTruncation(content));
  findings.push(...findPlaceholders(content));
  findings.push(...findMetaLeak(content));
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

function isContent(trimmed) {
  return trimmed && !trimmed.startsWith('#') && !/^-{3,}$/.test(trimmed);
}

function isDialogueLike(trimmed) {
  return /["""'''「」『』【】]/.test(trimmed);
}

// 쌍을 이루는 인용부호 내 구간(대사/시스템 단어/참조 객체) 제거, 인용부호 외 서술만 보존. 중복 판정용: 반복되는 대사는 체재 수법(면제) 대상이지만, 「서술 + 인용부호 내 객체/짧은 대사」 혼합 행에서 인용부호 외 서술의 중복은 여전히 퇴화로, 전체 행 면제 불가.
// 면제(exemption), 하지만 「서술 + 인용부호 내 물건/짧은 대사」 혼합 행에서 인용부호 외 서술의 중복은 여전히 퇴화, 전체 행 면제 불가.
function stripQuoted(text) {
  return text
    .replace(/「[^」]*」/g, '')
    .replace(/『[^』]*』/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/“[^”]*”/g, '')
    .replace(/‘[^’]*’/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/'[^']*'/g, '');
}

function visibleLength(text) {
  const m = text.match(/[一-鿿Ａ-ｚA-Za-z0-9]/g);
  return m ? m.length : 0;
}

function findRepetition(content) {
  const findings = [];
  const body = content.filter((c) => isContent(c.trimmed));

  // (1) back-to-back identical lines (immediate loop). 순수 대사/채팅 반복(따옴표 외 설명이 매우 짧음)은 제외; 
  // 「설명 + 따옴표 내 객체」혼합행의 전체행 반복은 여전히 판정(따옴표 제거 후 설명이 충분히 김).
  for (let i = 1; i < body.length; i += 1) {
    if (
      body[i].trimmed === body[i - 1].trimmed &&
      visibleLength(stripQuoted(body[i].trimmed)) >= ADJACENT_MIN_LEN
    ) {
      findings.push({
        line: body[i].lineNo,
        column: 1,
        type: 'verbatim-repeat',
        severity: 'blocking',
        message: '줄 단위 반복(인접 전체행 중복): 모델이 제자리걸음을 하는 것으로 의심되며, 이 부분을 다시 작성하고 중복을 삭제하세요.',
        excerpt: compact(body[i].trimmed),
      });
    }
  }

  // (2) any long sentence repeated >= REPEAT_MIN_COUNT times across the file.
  // 인용부호 내 대사만 제외합니다(문체 기법). 인용부호 외 서술문은 여전히 반복 횟수를 계산합니다(「서술+인용부호 내 객체」혼합행 포함).
  const counts = new Map();
  for (const { trimmed } of body) {
    for (const sentence of stripQuoted(trimmed).split(/[。！？!?]/)) {
      const s = sentence.trim();
      if (visibleLength(s) < REPEAT_MIN_LEN) continue;
      const entry = counts.get(s) || { count: 0, firstLine: null };
      entry.count += 1;
      counts.set(s, entry);
    }
  }
  // record first line for repeated sentences
  const flagged = new Set();
  for (const [s, entry] of counts) {
    if (entry.count >= REPEAT_MIN_COUNT) flagged.add(s);
  }
  if (flagged.size) {
    for (const { trimmed, lineNo } of body) {
      for (const sentence of stripQuoted(trimmed).split(/[。！？!?]/)) {
        const s = sentence.trim();
        if (flagged.has(s)) {
          findings.push({
            line: lineNo,
            column: 1,
            type: 'verbatim-repeat',
            severity: 'blocking',
            message: `장문 반복(동일 문장 ${counts.get(s).count}회 출현): 모델이 루프를 도는 것으로 의심됩니다. 재작성 또는 한 곳만 보존하세요.`,
            excerpt: compact(s),
          });
          flagged.delete(s); // report each repeated sentence once, at its first occurrence
        }
      }
    }
  }

  return findings;
}

function findTruncation(content) {
  const body = content.filter((c) => isContent(c.trimmed));
  if (body.length === 0) return [];
  const last = body[body.length - 1];
  // a finished chapter ends on terminal/closing punctuation; otherwise it was cut off.
  if (/[。！？!?…""』」）)】]$/.test(last.trimmed)) return [];
  return [{
    line: last.lineNo,
    column: last.trimmed.length,
    type: 'truncated',
    severity: 'blocking',
    message: '의심되는 절단: 본문 끝이 문장 끝/종료 문장 부호로 끝나지 않아, 모델에 의해 중도에 중단되었을 가능성이 있습니다; 끝을 보완하거나 종료를 다시 작성하세요.',
    excerpt: compact(last.trimmed.slice(-24)),
  }];
}

function findPlaceholders(content) {
  const findings = [];
  for (const { trimmed, lineNo } of content) {
    if (!isContent(trimmed)) continue;
    const dialogue = isDialogueLike(trimmed);
    for (const { re, label, hard } of PLACEHOLDER_PATTERNS) {
      if (!hard && dialogue) continue; // soft 거부 문구가 대사 줄에 있을 수 있으므로 정상 대사로 간주하여 제외합니다.
      const m = re.exec(trimmed);
      if (m) {
        findings.push({
          line: lineNo,
          column: (m.index || 0) + 1,
          type: 'placeholder-leak',
          severity: 'blocking',
          message: `${label}: 본문에 메타정보/거부 문구/placeholder가 혼입되었습니다. 이 섹션을 명확하게 다시 작성하세요.`,
          excerpt: compact(trimmed.slice(Math.max(0, (m.index || 0) - 4), (m.index || 0) + 20)),
        });
        break; // one finding per line is enough
      }
    }
  }
  return findings;
}

function findMetaLeak(content) {
  const findings = [];
  let firstContentSeen = false;
  for (const { trimmed, lineNo } of content) {
    if (!isContent(trimmed)) continue;
    if (!firstContentSeen) {
      firstContentSeen = true;
      // 제목 줄(제N장 장명, ## 접두사가 없을 때도 포함)은 「제목 줄 외 본문」에서 제외됩니다.
      if (/^第[一二三四五六七八九十百千万两0-9]+章/.test(trimmed)) continue;
    }
    const dialogue = isDialogueLike(trimmed);
    let m = META_TIER1_RE.exec(trimmed);
    if (m) {
      // tier1 순공학 용어는 정문에서 거의 항상 부적절함→blocking; 하지만 작가/시나리오 소재에서는 캐릭터가 이야기 내에서 창작을 실제로 논의할 때,
      // 대사(대화 줄)에서는 합법일 수 있으므로 advisory로 강등함(여전히 보고하지만, 사람/LLM이 판단하며 강제 수정 없음).
      findings.push({
        line: lineNo,
        column: m.index + 1,
        type: 'meta-leak',
        severity: dialogue ? 'advisory' : 'blocking',
        message: `공학 용어 유출: 「${m[0]}」은(는) 작문 파이프라인 용어로, 정문에 나타나면 안 됨; 캐릭터/장면 내 표현으로 수정하세요.${dialogue ? '예외: 캐릭터가 작가/시나리오 작가이고 이야기 내에서 창작을 실제로 논의할 때는 대사에서 합법일 수 있음.' : ''}`,
        excerpt: compact(trimmed.slice(Math.max(0, m.index - 6), m.index + 18)),
      });
      continue; // tier1 명중 시 충분함, tier2 중첩 금지
    }
    m = META_TIER2_RE.exec(trimmed);
    if (m) {
      findings.push({
        line: lineNo,
        column: m.index + 1,
        type: 'meta-leak',
        severity: 'advisory',
        message: `메타정보 유출: 「${m[0]}」은(는) 공학/장 구조 용어가 정문에 섞인 것으로 의심됨; 캐릭터가 현재 감지 가능한 이벤트 앵커포인트 또는 상대적 시간으로 수정하세요. 예외: 캐릭터가 이야기 내에서 실제로 「제X장」을 읽거나/논의하거나, 실제 정체가 작가/독자이거나, 이야기 내 시스템/인터페이스 용어인 경우.`,
        excerpt: compact(trimmed.slice(Math.max(0, m.index - 6), m.index + 18)),
      });
    }
  }
  return findings;
}

function hasYamlFrontMatter(lines) {
  if (!lines[0] || lines[0].trim() !== '---') return false;
  let sawYamlField = false;
  for (let i = 1; i < Math.min(lines.length, 40); i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '---') return sawYamlField;
    if (/^[A-Za-z0-9_-]+:\s*/.test(trimmed)) sawYamlField = true;
  }
  return false;
}

function compact(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}
