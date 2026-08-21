#!/bin/bash
# guard-outline-before-prose.sh — PreToolUse(Write|Edit|MultiEdit) 흐름 가드
# 「본문」을 작성하기 전에 해당 대개요/세부 개요가 있어야 하며, 없으면 차단합니다(exit 2, BLOCKING).
#
# 다음 세 가지를 차단합니다:
#   - 장편正文/第N章_*.md를 처음 만들 때 세부 개요가 없으면 같은 책의 大纲/细纲_第N章.md를 요구
#   - 단편 正文.md를 처음 만들 때 대개요가 없으면 같은 디렉터리의 小节大纲.md를 요구
#   - 장편 추적 검사점이 성립하지 않음: state 누락/schema 불일치/이어쓰기 상태 카드 수정 번호 불일치/새 장을 처음 만들 때
#     이전 장 트랜잭션이 커밋되지 않은 경우(판정은 opencode/zcode/codex와 동일한 공유 핵심을 사용; 아래 해당 주석 참조)
# 세부 개요/대개요 문은 처음 만들 때만 검사하고, 추적 문은 신규 작성과 이어쓰기 모두 검사합니다(JS 핵심의 proseBlockReason과 동일한 순서).
# 본문 대상이 아니거나 경로를 해석할 수 없으면 항상 조용히 통과시킵니다.
# 설계 원칙: 잘못 차단하기보다 놓치는 편을 택함 — 불확실하면 항상 exit 0.
set -euo pipefail

source "$(dirname "$0")/lib/common.sh"

# 전체 과정은 바이트 안정 영역에서 실행합니다. 이 hook은 중국어 경로에서 bash 와일드카드를 사용하므로(중간 디렉터리가 중국어 서명일 때
# 细纲_第*章*.md가 GBK 영역에서 NOMATCH가 됨), sed로 장 번호를 추출하고 case로 매칭합니다. Windows 중국어 시스템이
# GBK/GB2312 로케일을 내보내면 이 과정이 모두 UTF-8을 다중 바이트로 잘못 해석해 실패합니다. C 로케일을 강제해 바이트 매칭을 수행해야(UTF-8
# 리터럴과 UTF-8 바이트가 일치) 안정적으로 동작합니다(issue #164). 경로 추출은 node 공유 핵심을 사용하며 node 자체는 UTF-8로
# 처리하므로 bash 로케일과 무관합니다. 차단 판정은 아래 bash에서 수행되므로 영향을 받지 않습니다.
export LC_ALL=C

HOOK_INPUT="${CLAUDE_TOOL_INPUT:-}"
if [ -z "$HOOK_INPUT" ] && [ ! -t 0 ]; then
  HOOK_INPUT="$(cat)"
fi
# 의도적으로 export하지 않습니다. Write/Edit/MultiEdit 페이로드에는 장 전체 본문이 들어가며(MultiEdit에는 old_string+new_string도 포함),
# export하면 이 값이 본 스크립트의 모든 자식 프로세스 envp에 들어가 페이로드가 클 때 execve가 E2BIG을 반환합니다(Linux 단일 환경 변수 한도
# 128 KiB, macOS 전체 1 MiB). dirname/sed/node가 모두 「Argument list too long」을 출력하고 본 가드는
# exit 2에 도달하기 전에 종료되어 「비차단 오류」로 전락하고 이번 쓰기를 통과시키게 되어 BLOCKING 계약에 어긋납니다. 따라서 페이로드가 필요한
# node 호출에만 파이프로 stdin을 공급합니다(story_hook_cli.js extract-target은 HOOK_INPUT이 없을 때 stdin을 읽음).
# 아래 extract_target_bash는 printf 내장 명령을 사용하므로 export가 필요 없습니다.

# 대상 파일 경로 추출: node 공유 핵심을 우선 사용(다른 구현과 동일한 구현). node가 없거나 node는 있지만 추출에 실패하면
# 순수 bash 추출로 전환합니다. 이 가드는 차단용이므로 node 문제 때문에 fail-open하면 안 됩니다. 현재 공식은 네이티브 바이너리 설치를
# Claude Code에 권장하며 npm 설치 방식에만 Node가 포함되고 native 런타임에는 node가 없을 수 있습니다. 구형 node는 node: 접두사를 인식하지 못하거나
# 배포된 핵심이 손상되면 node 탐지는 통과하지만 추출은 오류를 냅니다. 대상 경로를 해석할 수 있으면 정상적으로 차단 판정을 수행하고, 두 경로 모두 추출하지 못할 때만
# 통과시킵니다(잘못 차단하기보다 놓치는 편을 택함).
CLI="$(dirname "$0")/story_hook_cli.js"

# 순수 bash JSON 추출 대체 경로: dig 우선순위에 따라 처음 나타나는 file_path/path/filePath 문자열 값을 취합니다. Claude(node
# 애플리케이션)의 hook 페이로드는 JSON.stringify를 거칩니다. 비 ASCII 경로는 원시 UTF-8(\uXXXX로 변환하지 않음)이고 Windows 드라이브 문자는
# 경로가 \\로 이스케이프됩니다. 둘 다 bash에서 복원할 수 있으며 아래 드라이브 문자 분기에서 \를 /로 통일합니다. node가 없거나 node는 있지만
# 추출에 실패하면 활성화합니다.
extract_target_bash() {
  local key val
  for key in file_path path filePath; do
    val="$(printf '%s' "$HOOK_INPUT" \
      | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" \
      | head -n1 \
      | sed -E "s/^\"$key\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//")"
    if [ -n "$val" ]; then
      val="${val//\\\"/\"}"   # \" -> "
      val="${val//\\\\/\\}"   # \\ -> \
      printf '%s' "$val"
      return 0
    fi
  done
  return 1
}

TARGET=""
if node -e "" >/dev/null 2>&1 && [ -f "$CLI" ]; then
  TARGET="$(printf '%s' "$HOOK_INPUT" | node "$CLI" extract-target 2>/dev/null || true)"
fi
# node가 있지만 결과가 비어 있어도(구형 node가 node: 접두사를 인식하지 못하거나 핵심 손상으로 탐지는 통과하지만 추출에 오류가 나는 경우) 순수 bash로 전환합니다.
# 그렇지 않으면 fail-open이 됩니다. 두 경로 모두 해석하지 못할 때만 통과시킵니다.
[ -z "$TARGET" ] && TARGET="$(extract_target_bash 2>/dev/null || true)"
[ -z "$TARGET" ] && exit 0

ROOT=$(project_root)
# 절대 경로는 그대로 사용하고 상대 경로만 프로젝트 루트를 앞에 붙입니다.
# Windows + Git Bash에서 Claude Code가 드라이브 문자 절대 경로(F:/work/... 또는 F:\work\...)를 전달할 수 있습니다.
# /*만 인식하면 이를 상대 경로로 취급해 $ROOT/F:/work/...로 붙이므로 大纲/ 디렉터리를 잘못 찾고 세부 개요 누락을 오판합니다(issue #184).
# [A-Za-z]:[/\\]*로 드라이브 문자 절대 경로를 인식하고 역슬래시를 슬래시로 통일합니다(plugin.ts의 isAbsolute + 역슬래시 정규화와 일치).
case "$TARGET" in
  /*) ABS="$TARGET" ;;
  [A-Za-z]:[/\\]*) ABS="${TARGET//\\//}" ;;
  *)  ABS="$ROOT/$TARGET" ;;
esac

BASE="$(basename "$ABS")"
PARENT="$(basename "$(dirname "$ABS")")"

case "$BASE" in
  正文.md)
    # 단편 단일 파일 본문: 이미 존재하면 통과(이어쓰기/개고)
    [ -f "$ABS" ] && exit 0
    BOOK_DIR="$(dirname "$ABS")"
    # story-import 마이그레이션: 拆文库/{书名}/ 분석 원본이 이미 있으면 본문이 소절 대개요보다 먼저 이동되는 정상 흐름이므로 통과(소절 대개요는 분할 문서에서 역산)
    [ -d "$ROOT/拆文库/$(basename "$BOOK_DIR")" ] && exit 0
    # 실제 단편 프로젝트일 때만 차단합니다(设定.md 신호가 있어야 함 — story-short-write/import가 먼저 设定.md를 생성).
    # docs/正文.md 같은 작품 외 파일의 오탐을 방지
    [ -f "$BOOK_DIR/设定.md" ] || exit 0
    if [ ! -f "$BOOK_DIR/小节大纲.md" ]; then
      printf '%s\n' "⛔ 본문 작성 차단: ${TARGET}에 같은 디렉터리의 小节大纲.md가 없습니다." >&2
      printf '%s\n' "   먼저 story-short-write에 따라 「小节大纲.md」를 완성한 뒤 본문을 작성하세요(대개요를 건너뛰고 바로 본문을 작성할 수 없습니다)." >&2
      printf '%s\n' "   먼저 초안을 작성해야 한다면 小节大纲.md를 먼저 보완해 만드세요." >&2
      exit 2
    fi
    ;;
  *)
    # 장편 분할 본문: 부모 디렉터리는 「正文」이어야 하며 파일명은 第N章... 형식이어야 함
    [ "$PARENT" = "正文" ] || exit 0
    case "$BASE" in
      第*章*.md) ;;
      *) exit 0 ;;
    esac
    # 장 번호(앞의 0 제거)
    NUM="$(printf '%s' "$BASE" | sed -n 's/^第0*\([0-9][0-9]*\)章.*/\1/p')"
    [ -z "$NUM" ] && exit 0
    BOOK_DIR="$(dirname "$(dirname "$ABS")")"
    # story-import 마이그레이션: 拆文库/{书名}/ 분석 원본이 있으면 통과(세부 개요는 장 요약에서 역산하며 본문 이동보다 늦음).
    # 追踪/_tracking-state.json이 존재하면 현재 추적 프로토콜에 들어가며, 拆文库/ 분석 자산이 남아 있다는 이유로
    # 영구적으로 가드를 우회하지 않습니다(story_hook_core.js와 동일한 판정을 유지).
    if [ -d "$ROOT/拆文库/$(basename "$BOOK_DIR")" ] && [ ! -f "$BOOK_DIR/追踪/_tracking-state.json" ]; then
      exit 0
    fi
    # 본문이 이미 존재하면(이어쓰기/개고/재작성) 세부 개요 문을 건너뛰지만 추적 검사점은 적용합니다 — JS 핵심의
    # proseBlockReason과 같은 순서: 세부 개요 문은 최초 작성 때만 검사하고 추적 문은 두 경우 모두 검사합니다.
    EXISTS=""
    [ -f "$ABS" ] && EXISTS=1
    if [ -z "$EXISTS" ]; then
      OUTLINE_DIR="$BOOK_DIR/大纲"
      FOUND=""
      if [ -d "$OUTLINE_DIR" ]; then
        # 앞자리 0 차이와 제목 접미사를 허용하고 정수 장 번호로 大纲/细纲_第*章*.md를 매칭
        for f in "$OUTLINE_DIR"/细纲_第*章*.md; do
          [ -e "$f" ] || continue
          fnum="$(basename "$f" | sed -n 's/^细纲_第0*\([0-9][0-9]*\)章.*/\1/p')"
          if [ "$fnum" = "$NUM" ]; then FOUND="$f"; break; fi
        done
      fi
      if [ -z "$FOUND" ]; then
        printf '%s\n' "⛔ 본문 작성 차단: 제 ${NUM}장에 세부 개요가 없습니다(${OUTLINE_DIR#$ROOT/}/细纲_第${NUM}章.md)." >&2
        printf '%s\n' "   먼저 story-long-write 단일 장 절차에 따라 세부 개요를 보완한 뒤 본문을 작성하세요(세부 개요를 건너뛰고 바로 작성할 수 없습니다)." >&2
        printf '%s\n' "   먼저 초안을 작성해야 한다면 해당 세부 개요 파일을 먼저 보완해 만드세요." >&2
        exit 2
      fi
    fi
    # 추적 검사점 문: state 누락 / schema가 4가 아님 / 이어쓰기 상태 카드 수정 번호와 state 불일치 / 새 장 최초 작성 시
    # 이전 장 트랜잭션이 커밋되지 않은 경우 모두 차단합니다. 판정은 공유 핵심(story_hook_cli.js tracking-checkpoint)을 사용하며,
    # opencode/zcode/codex와 동일한 구현입니다 — issue #305 이전에는 이 문이 JS 핵심과 codex py에만 들어가
    # Claude 측에만 빠져 있어 추적 없는 본문이 여러 장 조용히 작성되었습니다.
    # JSON 해석이 필요하므로 node에 의존합니다. node·핵심이 없거나 하위 명령을 인식하지 못하면 모두 통과시킵니다(잘못 차단하기보다 놓치는 편을 택함,
    # 이 파일의 다른 대체 경로와 동일). SessionStart 연속성 알림과 배치 종료 check가 여전히 보완합니다.
    if node -e "" >/dev/null 2>&1 && [ -f "$CLI" ]; then
      # 새 장을 최초 작성할 때만 순서 검사를 수행(이전 장이 커밋되어 있어야 함). 이미 존재하는 본문은 `-`를 전달해 state 자체만 검사합니다.
      EXPECT="-"
      [ -z "$EXISTS" ] && EXPECT=$((NUM - 1))
      CHECKPOINT="$(node "$CLI" tracking-checkpoint "$ROOT" "$BOOK_DIR" "$EXPECT" 2>/dev/null || true)"
      if [ -n "$CHECKPOINT" ]; then
        printf '%s\n' "$CHECKPOINT" >&2
        exit 2
      fi
    fi
    # 본문이 이미 존재하면 여기서 종료합니다. 미처리 잔액 문은 새 장 최초 작성에만 적용됩니다.
    [ -n "$EXISTS" ] && exit 0
    # 미처리 잔액 문(state 없음): 제 N장을 최초 작성하기 전에 이전 장에 정리되지 않은 유해 문장 패턴이 있고 「去味:跳过」 면제가 표시되지 않았으면 먼저 정리해야 합니다.
    # 유해 문장 패턴 검사는 공유 핵심 prose-toxic 하위 명령을 사용합니다(작성 후 검사와 동일한 규칙). node·핵심이 없거나 검사에 실패하면 모두
    # 통과시킵니다(잘못 차단하기보다 놓치는 편을 택함) — 작성 후 검사와 SKILL의 동일 회차 원칙이 보완합니다. 판정은 이전 장 파일에서 즉시 계산하며 state를 사용하지 않습니다.
    PREV=$((NUM - 1))
    if [ "$PREV" -ge 1 ] && node -e "" >/dev/null 2>&1 && [ -f "$CLI" ]; then
      PROSE_DIR="$(dirname "$ABS")"
      PREV_FILE=""
      # glob은 사전순으로 정렬되지만 같은 장 번호의 원고 백업(workflow-revision의 「원고 백업」 산출물)도
      # 매칭되므로 _原稿_을 명시적으로 건너뛰어 JS 핵심/codex py와 동일한 「이전 장」을 선택합니다.
      for f in "$PROSE_DIR"/第*章*.md; do
        [ -e "$f" ] || continue
        case "$(basename "$f")" in *_原稿_*) continue ;; esac
        pnum="$(basename "$f" | sed -n 's/^第0*\([0-9][0-9]*\)章.*/\1/p')"
        if [ "$pnum" = "$PREV" ]; then PREV_FILE="$f"; break; fi
      done
      if [ -n "$PREV_FILE" ] && ! head -n 6 "$PREV_FILE" | grep -qE '去味(：|:)跳过'; then
        TOXIC="$(node "$CLI" prose-toxic "$PREV_FILE" 2>/dev/null || true)"
        if [ -n "$TOXIC" ]; then
          printf '%s\n' "⛔ 본문 작성 차단: 이전 장($(basename "$PREV_FILE"))에 정리되지 않은 유해 문장 패턴 잔액이 있습니다. 먼저 정리한 뒤 제 ${NUM}장을 작성하세요. 사용자가 명시적으로 면제하려면 이전 장 제목 아래에 <!-- 去味:跳过 -->를 추가한 뒤 다시 시도하세요." >&2
          # 처음 8개만 나열합니다. `printf … | head -n 8`로 작성하면 안 됩니다. 잔액이 많을 때 head가 먼저 종료되어 printf가 SIGPIPE를 받고,
          # pipefail에서 전체 파이프라인이 141을 반환하고 set -e가 즉시 스크립트를 종료하므로 아래 exit 2에 도달하지 못해 차단이
          # 「비차단 오류」로 바뀌어 이번 쓰기를 통과시킵니다. here-string으로 head에 직접 공급하면(파이프가 없어 SIGPIPE가 없음),
          # 한 겹 더 || true로 감싸 어떤 경우에도 exit 2에 도달하도록 합니다.
          head -n 8 <<< "$TOXIC" >&2 || true
          exit 2
        fi
      fi
    fi
    ;;
esac

exit 0
