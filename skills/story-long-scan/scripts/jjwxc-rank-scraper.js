#!/usr/bin/env node
/**
 * 진강문학성 랭킹 수집 스크립트
 *
 * browser-cdp skill과 함께 사용합니다. 먼저 Chrome CDP 환경을 시작한 후 본 스크립트를 실행하세요.
 * 수집 전략:
 *   1) topten.php 목록 페이지(순수 텍스트, 채널명 직접 표시, 책명/저자 교대로 표시)에서 채널 그룹을 추출합니다.
 *   2) 책명 anchor에서 novelid를 가져와 onebook.php 상세 페이지로 각각 진입하여 핵심 지표를 보충 수집합니다.
 *      (수집 수/영양액/적분/글자수/상태)는 진강의 기술 요구사항을 충족합니다.
 * 진강 페이지는 gb18030 인코딩입니다: 상세 페이지는 fetch+arrayBuffer+TextDecoder('gb18030')로 디코딩합니다.
 *   (동기 XHR의 responseText는 UTF-8로 디코딩되어 중국어 깨짐이 발생합니다).
 * 상세 수집은 기본적으로 활성화되지만 제한이 있습니다(각 채널 상위 N + 총량 제한), --list-only로 목록만 수집할 수 있습니다.
 *
 * 사용법:
 *   node jjwxc-rank-scraper.js --type 12                  # 수익 랭킹（기본값으로 상세 정보 포함）
 *   node jjwxc-rank-scraper.js --type 12 --top 15         # 각 채널별 상위 15개 추가 수집
 *   node jjwxc-rank-scraper.js --type 12 --detail-limit 60 # 상세 정보 총 제한량 60
 *   node jjwxc-rank-scraper.js --type 12 --list-only      # 목록만 수집（빠름, 핵심 지표 없음）
 *   node jjwxc-rank-scraper.js --type all                 # 전체 랭킹
 *
 * 전제 조건:
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSONBase64, getArg, localDateStamp, runCli } = require("./cdp-utils");

const BASE_URL = "https://www.jjwxc.net/topten.php";

const RANK_TYPES = [
  { id: "12", label: "수입 랭킹" },
  { id: "7", label: "월간 랭킹" },
  { id: "8", label: "분기별 랭킹" },
  { id: "14", label: "완결 금상 랭킹" },
  { id: "15", label: "신인 금상" },
  { id: "17", label: "천자 금상" },
];

// 상세 요청 배치 크기 (async fetch 동시성, 전체 배치는 ab() 20초 타임아웃 내로 제어됨)
const DETAIL_CHUNK = 6;

/** 연결성 + 페이지 준비 자체 검사 */
function probePage(port) {
  return evalJSONBase64(
    port,
    "JSON.stringify({host:location.host,len:(document.body&&document.body.innerText||'').length})"
  );
}

// ---------------------------------------------------------------------------
// 목록 페이지 추출
// ---------------------------------------------------------------------------

/**
 * 진강 랭킹 데이터를 추출하고(채널 분류 + 책 제목/작가 교대로), 책 제목 anchor에서 novelid를 추출합니다.
 */
function extractRankData(port) {
  const js =
    "JSON.stringify((function(){" +
    "var result={channels:[]};" +
    "var text=document.body.innerText||'';" +
    "var lines=text.split(/\\n/).map(function(l){return l.trim()}).filter(Boolean);" +
    // 책 제목 anchor → novelid(보스 투표 "X향《책 제목》투了Y" 같은 기록 제외)
    "var idMap={};" +
    "Array.from(document.querySelectorAll('a')).forEach(function(a){" +
    "  var hm=(a.getAttribute('href')||'').match(/novelid=([0-9]+)/);if(!hm)return;" +
    "  var t=(a.innerText||a.textContent||'').trim();" +
    "  if(!t||t.indexOf('향《')>-1||t.indexOf('투')>-1||t.length>30)return;" +
    "  if(!idMap[t])idMap[t]=hm[1];" +
    "});" +
    "var channels=['고대 로맨스','현대 로맨스','고대 시간여행','현대 도시 순로맨스','현대 판타지 순로맨스','고대 순로맨스','파생 순로맨스','판타지 현대 로맨스','판타지 로맨스','미래 게임 미스터리','백합','CP 없음','2차원 로맨스','파생 로맨스','파생 CP 없음','미래 판타지 순로맨스','오리지널 라이트 노벨','다원'];" +
    "var channelSet={};channels.forEach(function(c){channelSet[c]=true});" +
    "var curChannel='';" +
    "var channelBooks={};" +
    "var expectTitle=true;" +
    "var pendingTitle='';" +
    "for(var i=0;i<lines.length;i++){" +
    "  var line=lines[i];" +
    "  if(/랭킹 입선 기간 기록|랭킹 설명/.test(line)){break}" +
    "  if(/^(무료 강추|VIP 강추|신인 작가|월간 순위|계절 순위|반년 순위|장생전|종합 점수 순위|글자 수 순위|수익 금상|패왕표|패왕 종합 순위|근면 지수|완결 금상|신수 금상|재배 월간 순위|상주|완결 고득점|천자 금상|완결 전체 구독 순위)$/.test(line)){continue}" +
    "  if(line.length>30&&line.indexOf('·')>0)continue;" +
    "  if(channelSet[line]){" +
    "    if(curChannel&&channelBooks[curChannel])channelBooks[curChannel]._finished=true;" +
    "    curChannel=line;" +
    "    if(!channelBooks[curChannel])channelBooks[curChannel]={books:[]};" +
    "    expectTitle=true;pendingTitle='';continue" +
    "  }" +
    "  if(!curChannel)continue;" +
    "  if(expectTitle){" +
    "    pendingTitle=line;expectTitle=false" +
    "  }else{" +
    "    if(pendingTitle){" +
    "      channelBooks[curChannel].books.push({title:pendingTitle,author:line,novelid:idMap[pendingTitle]||''})" +
    "    }" +
    "    expectTitle=true;pendingTitle=''" +
    "  }" +
    "}" +
    "for(var name in channelBooks){" +
    "  if(channelBooks[name].books.length>0){" +
    "    result.channels.push({name:name,books:channelBooks[name].books})" +
    "  }" +
    "}" +
    "return result" +
    "})())";
  return evalJSONBase64(port, js);
}

// ---------------------------------------------------------------------------
// 상세 페이지 추출(gb18030 + itemprop 마이크로데이터)
// ---------------------------------------------------------------------------

/** 구성: 일괄 novelid의 상세 정보 디코딩 JS(async fetch + TextDecoder, JSON 문자열 반환) */
function buildDetailJS(ids) {
  return `Promise.all(${JSON.stringify(ids)}.map(function(id){
    return fetch('/onebook.php?novelid='+id)
      .then(function(r){return r.arrayBuffer()})
      .then(function(b){
        var h=new TextDecoder('gb18030').decode(new Uint8Array(b));
        function prop(n){var m=h.match(new RegExp('itemprop="'+n+'"[^>]*>([^<]*)<'));return m?m[1].trim():'';}
        var status=(h.match(/itemprop="updataStatus"[^>]*>\\s*([^<\\s]{1,6})/)||[,''])[1]
                 ||(h.match(/(연재 중|완결됨|완결)/)||[,''])[1]||'';
        return {id:id,collect:prop('collectedCount'),nutrition:prop('nutritionCount'),
                score:prop('scoreCount'),review:prop('reviewCount'),words:prop('wordCount'),status:status};
      })
      .catch(function(e){return {id:id,err:String(e&&e.message||e)}});
  })).then(function(arr){var map={};arr.forEach(function(o){map[o.id]=o});return JSON.stringify(map);})`;
}

/**
 * 배치 단위 디코딩 상세 정보, 결과 병합.
 * 각 배치별로 독립적인 try/catch: 전체 배치의 동시 fetch가 ab()의 20초 타임아웃 한계에 붙어있으므로, 한 번의 순간 타임아웃(또는
 * JSON이 아닌 응답)은 이 6권만 버려야 하며, 뒤따르는 수십 권까지 연루시키면 안 되고, 이미 파싱된 목록까지 가져가면 안 됩니다.
 */
function fetchDetails(port, ids) {
  const map = {};
  let failedChunks = 0;
  for (let i = 0; i < ids.length; i += DETAIL_CHUNK) {
    const chunk = ids.slice(i, i + DETAIL_CHUNK);
    try {
      const part = evalJSONBase64(port, buildDetailJS(chunk)) || {};
      Object.assign(map, part);
    } catch (chunkErr) {
      failedChunks++;
      console.error(
        `  ⚠ 상세 배치 ${Math.floor(i / DETAIL_CHUNK) + 1}(${chunk.length} 권) 조회 실패, 건너뜀: ${chunkErr.message}`
      );
    }
    sleep(400);
  }
  if (failedChunks > 0) {
    console.error(`  ⚠ 총 ${failedChunks}개 상세 배치 실패, 이 부분 도서는 목록 데이터만 있습니다.`);
  }
  return { map, failedChunks };
}

// ---------------------------------------------------------------------------
// 포맷팅
// ---------------------------------------------------------------------------

function fmtWan(s, unit) {
  if (s == null || s === "") return "";
  const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10);
  if (isNaN(n)) return "";
  if (n >= 10000) return (n / 10000).toFixed(1) + "만" + (unit || "");
  return n + (unit || "");
}

// ---------------------------------------------------------------------------
// 메인 프로세스
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const RANKTYPE = getArg(args, "--type") || "12";
const CHANNEL = getArg(args, "--channel") || "0";
const TOP = parseInt(getArg(args, "--top") || "10", 10);
const DETAIL_LIMIT = parseInt(getArg(args, "--detail-limit") || "100", 10);
const LIST_ONLY = args.includes("--list-only");

function scrapeRank(port, rankTypeId, channelId) {
  const rt = RANK_TYPES.find((r) => r.id === rankTypeId);
  if (!rt) {
    console.log(`  ⚠ 알 수 없는 랭킹 유형: ${rankTypeId}`);
    return null;
  }

  const url = `${BASE_URL}?orderstr=${rankTypeId}&t=${channelId}`;
  const chLabel = channelId === "0" ? "전체 사이트" : `채널${channelId}`;
  console.log(`\n→ 진장 ${rt.label}(${chLabel}) 수집 중...`);
  console.log(`  URL: ${url}`);

  let data;
  try {
    ab(port, "open", url);
    sleep(4000);

    // 연결성 자체 검사: CDP가 시작되지 않았거나 리디렉션될 때 조작 가능한 오류를 표시하되, "구조 변경됨"으로 잘못 보고하지 않음
    const probe = probePage(port);
    if (!probe) {
      console.error(
        `  ✗ CDP 응답 없음. browser-cdp로 Chrome을 시작했는지 확인하세요(포트 ${port}). agent-browser를 사용할 수 있어야 합니다.`
      );
      return null;
    }
    if (probe.host && probe.host.indexOf("jjwxc") === -1) {
      console.error(`  ✗ 현재 페이지가 진장(host=${probe.host})이 아닙니다. 리디렉션되었을 수 있으므로 건너뛰었습니다.`);
      return null;
    }

    data = extractRankData(port);
    if (!data?.channels?.length) {
      console.error(`[jjwxc] 수집 실패: 랭킹을 파싱하지 못했습니다(페이지 구조가 변경되었거나 로드되지 않았을 수 있음). ${url}을 직접 열어 확인하세요.`);
      return null;
    }
  } catch (err) {
    console.error(`[jjwxc] ${rt.label} 페이지 로드 또는 추출 오류: ${err.message}`);
    return null;
  }

  let totalBooks = 0;
  data.channels.forEach((ch) => {
    totalBooks += ch.books.length;
    const authors = new Set(ch.books.map((b) => b.author));
    if (ch.books.length >= 5 && authors.size / ch.books.length < 0.2) {
      console.log(`  ⚠ ${ch.name}：${ch.books.length} 권에 ${authors.size} 명의 고유 작가만 있습니다. 추출 오류가 있을 수 있습니다`);
    }
  });
  console.log(`  ✓ 리스트：${data.channels.length} 개 채널, 총 ${totalBooks} 권`);

  // 각 채널별 상위 TOP 권(novelid가 있는)을 선택하여 상세 정보 보충, DETAIL_LIMIT 총량 제약 적용
  let detailMap = {};
  let detailPlanned = 0;
  let detailOk = 0;
  let detailFailedChunks = 0;
  if (!LIST_ONLY) {
    const picked = [];
    for (const ch of data.channels) {
      let n = 0;
      for (const b of ch.books) {
        if (picked.length >= DETAIL_LIMIT) break;
        if (n >= TOP) break;
        if (b.novelid) { picked.push(b.novelid); n++; }
      }
      if (picked.length >= DETAIL_LIMIT) break;
    }
    detailPlanned = picked.length;
    if (picked.length) {
      console.log(`  → 상세 정보 보충 ${picked.length} 권(채널별 상위 ${TOP}, 상한 ${DETAIL_LIMIT})...`);
      // 상세 정보는 리스트의 보충이며 전제가 아님: 전체 구간 실패해도 이미 파싱된 리스트는 저장 유지
      // (아래의 품질 게이트가 detailOk===0을 [상세정보 파싱 오류/로그인 상태 누락]으로 표시합니다)
      try {
        const detailResult = fetchDetails(port, picked);
        detailMap = detailResult.map;
        detailFailedChunks = detailResult.failedChunks;
      } catch (detailErr) {
        detailMap = {};
        detailFailedChunks = Math.max(1, Math.ceil(picked.length / DETAIL_CHUNK));
        console.error(`  ⚠ 상세정보 보충 수집 전체 실패, 목록 데이터만 유지: ${detailErr.message}`);
      }
      detailOk = Object.values(detailMap).filter((d) => d && d.collect).length;
      console.log(`  ✓ 상세정보 북마크 수 명중 ${detailOk}/${picked.length}`);
    }
  }

  // 품질 상태: 상세정보 활성화 시 북마크 수 명중률이 핵심 신호입니다
  let quality = "[OK]";
  const detailPartial =
    !LIST_ONLY &&
    detailPlanned > 0 &&
    (detailFailedChunks > 0 || detailOk < detailPlanned);
  if (!LIST_ONLY && detailPlanned > 0 && detailOk === 0) {
    quality = "[상세정보 파싱 오류/로그인 상태 누락]";
    console.error(`  ⚠ 상세 정보 전체 수집 불가: 페이지 구조 변동이거나 로그인이 필요할 수 있으며, 파일 헤더에 표시했습니다.`);
  } else if (detailPartial) {
    quality = "[일부 상세 정보 누락]";
    console.error(`  ⚠ 상세 정보가 ${detailOk}/${detailPlanned}개만 수집됨, 부분 결과로 표시했습니다.`);
  } else if (LIST_ONLY) {
    quality = "[목록만 제공-핵심 지표 없음]";
  }

  const now = new Date().toISOString();
  const lines = [
    `# 진강 · ${rt.label}`,
    "",
    `- 출처：${url}`,
    `- 수집 시간：${now}`,
    `- 채널 수：${data.channels.length}`,
    `- 전체 항목 수：${totalBooks}`,
    `- 상세 정보 수집：${detailOk} / ${detailPlanned}（각 채널 상위 ${TOP}개, 최대 ${DETAIL_LIMIT}개）`,
    `- 데이터 품질: ${quality}`,
    "",
    "---",
    "",
  ];

  for (const ch of data.channels) {
    try {
      lines.push(`## ${ch.name} — ${ch.books.length} 권`, "");
      for (let i = 0; i < ch.books.length; i++) {
        try {
          const b = ch.books[i];
          lines.push(`### #${i + 1} ${b.title}`);
          const d = b.novelid ? detailMap[b.novelid] : null;
          const seg = [b.author || ""];
          if (d) {
            if (d.collect) seg.push("수장 " + fmtWan(d.collect));
            if (d.nutrition) seg.push("영양액 " + fmtWan(d.nutrition));
            if (d.score) seg.push("포인트 " + d.score);
            if (d.words) seg.push("글자수 " + fmtWan(d.words, "글자"));
            if (d.status) seg.push(d.status);
          }
          const meta = seg.filter(Boolean).join(" · ");
          if (meta) lines.push(`*${meta}*`);
          if (b.novelid) lines.push(`[작품 페이지](https://www.jjwxc.net/onebook.php?novelid=${b.novelid})`);
          lines.push("");
        } catch (bookErr) {
          console.error(`[jjwxc] ${rt.label} ${ch.name} 제${i + 1}건 처리 중 오류 발생: ${bookErr.message}`);
          lines.push("");
        }
      }
      lines.push("---", "");
    } catch (chErr) {
      console.error(`[jjwxc] ${rt.label} 채널「${ch.name}」처리 중 오류 발생, 건너뜀: ${chErr.message}`);
    }
  }

  return {
    content: lines.join("\n"),
    partial: detailPartial,
    partialReason: detailPartial
      ? `${rt.label}: detail ${detailOk}/${detailPlanned}, failed chunks ${detailFailedChunks}`
      : "",
  };
}

function main() {
  const rankTypes = RANKTYPE === "all" ? RANK_TYPES.map((r) => r.id) : [RANKTYPE];
  const channels = [CHANNEL]; // 진강 채널 ID는 페이지에서 가져와야 하며, 기본값은 전체 사이트
  let written = 0;
  let failed = 0;
  let partial = false;
  const partialReasons = [];

  for (const rt of rankTypes) {
    for (const ch of channels) {
      // 목록별 격리: 한 목록의 오류가 --type all 뒤의 목록을 중단시키지 않음 (토마토/고슴도치고양이와 일치)
      try {
        const result = scrapeRank(PORT, rt, ch);
        if (!result) {
          failed++;
          const rtInfo = RANK_TYPES.find((r) => r.id === rt);
          partialReasons.push(`${rtInfo ? rtInfo.label : rt}: no usable data`);
          continue;
        }
        if (result.partial) {
          partial = true;
          if (result.partialReason) partialReasons.push(result.partialReason);
        }

        const rtInfo = RANK_TYPES.find((r) => r.id === rt);
        const date = localDateStamp();
        const chLabel = ch === "0" ? "전체" : `채널${ch}`;
```javascript
        const filename = `진강${rtInfo.label}_${chLabel}_${date}.md`;
```
        fs.mkdirSync(OUTDIR, { recursive: true });
        const filepath = path.join(OUTDIR, filename);
        fs.writeFileSync(filepath, result.content, "utf-8");
        written++;
        console.log(`  ✓ 저장 완료: ${filepath}`);
      } catch (rankErr) {
        failed++;
        const rtInfo = RANK_TYPES.find((r) => r.id === rt);
        const message = rankErr && rankErr.message ? rankErr.message : String(rankErr);
        partialReasons.push(`${rtInfo ? rtInfo.label : rt}: ${message}`);
        console.error(
          `[jjwxc] ${rtInfo ? rtInfo.label : rt} 수집 실패, 건너뜀: ${message}`
        );
      }
    }
  }
  return {
    planned: rankTypes.length * channels.length,
    written,
    failed,
    partial: partial || failed > 0,
    partialReasons,
  };
}

if (require.main === module) {
runCli(main, "진강 수집");
}

module.exports = { buildDetailJS, fmtWan };
