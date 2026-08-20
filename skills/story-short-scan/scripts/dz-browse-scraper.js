#!/usr/bin/env node
/**
 * 점중 독서 단편 수집 스크립트
 *
 * browser-cdp 스킬과 함께 사용합니다. 먼저 Chrome CDP 환경을 시작한 뒤 이 스크립트를 실행합니다.
 * 수집 방식: /book/{id} 링크를 뼈대로 삼고 bookId별로 각 작품의 여러 anchor를 묶습니다.
 * (표지·작품명+평점·소개 각각 하나)에서 작품명·평점·소개·작품 페이지를 추출한 뒤 카드
 * 컨테이너 텍스트에서 작가·태그·상태·글자 수와 최신 장을 추출합니다. innerText의 행 순서만으로 파싱해
 * UI 문구나 소개를 작품명으로 잘못 인식하는 일을 피합니다.
 * 출력은 Markdown 형식입니다.
 *
 * 사용법:
 *   node dz-browse-scraper.js --channel male              # 남성향
 *   node dz-browse-scraper.js --channel female             # 여성향
 *   node dz-browse-scraper.js --channel all                # 전체
 *
 * 사전 조건:
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSONBase64, safeStr, scrollLoad, getArg, localDateStamp, runCli } = require("./cdp-utils");

const CHANNELS = [
  { id: "male", label: "男频", tab: "男频", url: "https://www.ishugui.com/browse" },
  { id: "female", label: "女频", tab: "女频", url: "https://www.ishugui.com/browse/on3" },
];

// ---------------------------------------------------------------------------
// 페이지 조작
// ---------------------------------------------------------------------------

/** 연결 상태 및 페이지 준비 여부 자가 점검 */
function probePage(port) {
  return evalJSONBase64(
    port,
    "JSON.stringify({host:location.host,len:(document.body&&document.body.innerText||'').length})"
  );
}

/** 지정한 텍스트의 탭을 클릭합니다. */
function clickTab(port, text) {
  const js =
    "JSON.stringify((function(){" +
    "var all=document.querySelectorAll('div,span,a,button,li');" +
    "var el=Array.from(all).find(function(e){return (e.textContent||'').trim()===" + safeStr(text) + "});" +
    "if(el){el.click();return true}return false" +
    "})())";
  return evalJSONBase64(port, js);
}

/**
 * /book/{id} 링크를 뼈대로 삼아 작품별 필드를 묶습니다.
 * 작품명은 “작품명+평점” anchor에서 가져오고(끝의 X.X分 제거), 소개는 가장 긴 anchor에서 가져오며,
 * 작가·태그·상태·글자 수는 카드 컨테이너 텍스트에서 정규식으로 추출합니다.
 */
function buildStoriesJS() {
  return `JSON.stringify((function(){
    var anchors=Array.from(document.querySelectorAll('a')).filter(function(a){
      return /\\/book\\/[0-9]+/.test(a.getAttribute('href')||'');
    });
    var byId={};var order=[];
    anchors.forEach(function(a){
      var m=(a.getAttribute('href')||'').match(/\\/book\\/([0-9]+)/);if(!m)return;
      var id=m[1];var txt=(a.innerText||a.textContent||'').replace(/\\s+/g,' ').trim();
      if(!byId[id]){byId[id]={id:id,texts:[],node:a};order.push(id);}
      if(txt)byId[id].texts.push(txt);
    });
    var out=[];
    order.forEach(function(id){
      var g=byId[id];
      var title='',score='';
      for(var i=0;i<g.texts.length;i++){
        var tm=g.texts[i].match(/^(.+?)\\s*([0-9]+(?:\\.[0-9]+)?)分$/);
        if(tm){title=tm[1].trim();score=tm[2]+'分';break;}
      }
      if(!title){
        var cand=g.texts.filter(Boolean).slice().sort(function(a,b){return a.length-b.length;});
        title=cand.length?cand[0]:'';
      }
      // 소개: “작품명+평점”이 아닌 가장 긴 anchor 텍스트
      var desc='';
      g.texts.forEach(function(t){ if(/分$/.test(t))return; if(t.length>desc.length)desc=t; });
      // 카드 컨테이너: 임의의 anchor에서 위로 올라가 “字”를 포함한 조상을 찾음
      var el=g.node;
      for(var j=0;j<6;j++){ if(el.parentElement){el=el.parentElement; if((el.innerText||'').indexOf('字')>-1)break;} }
      var card=(el.innerText||'').replace(/\\s+/g,' ');
      var tail=(desc&&card.indexOf(desc)>-1)?card.slice(card.indexOf(desc)+desc.length):card;
      var meta=tail.match(/([^·]{1,20}?)\\s*·\\s*([^·]{1,20}?)\\s*·\\s*(完结|完本|连载)\\s*·\\s*([0-9]+)\\s*字/);
      var author=meta?meta[1].trim():'';
      var tag=meta?meta[2].trim():'';
      var status=meta?meta[3]:'';
      var words=meta?meta[4]+'字':'';
      var um=card.match(/最新章节[:：\\s]*([^·]{1,40})/);
      var update=um?um[1].trim():'';
      out.push({rank:out.length+1,bookId:id,title:title,score:score,author:author,tag:tag,status:status,words:words,update:update,desc:desc.slice(0,200),url:'https://www.ishugui.com/book/'+id});
    });
    return out;
  })())`;
}

function extractStories(port) {
  const list = evalJSONBase64(port, buildStoriesJS());
  return Array.isArray(list) ? list : [];
}

// ---------------------------------------------------------------------------
// 주요 흐름
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const CHANNEL = getArg(args, "--channel") || "male";

function scrapeChannel(port, channelId) {
  const ch = CHANNELS.find((c) => c.id === channelId);
  if (!ch) return null;

  console.log(`\n→ 점중 ${ch.label} 단편 수집 중...`);

  let stories;
  try {
    ab(port, "open", ch.url);
    sleep(3000);

    // 연결 상태 자가 점검: CDP가 시작되지 않았거나 리디렉션되었을 때 빈 결과를 조용히 내지 않고 조치 가능한 오류를 표시합니다.
    const probe = probePage(port);
    if (!probe) {
      console.error(
        `  ✗ CDP가 응답하지 않습니다. browser-cdp로 Chrome을 시작했는지(포트 ${port}), agent-browser를 사용할 수 있는지 확인하세요.`
      );
      return null;
    }
    if (probe.host && probe.host.indexOf("ishugui") === -1) {
      console.error(`  ✗ 현재 페이지는 점중이 아닙니다(host=${probe.host}). 리디렉션되었을 수 있어 건너뜁니다.`);
      return null;
    }

    // 채널 전환(female은 독립 URL이 있어 탭 전환 실패가 치명적이지 않음)
    try {
      if (clickTab(port, ch.tab)) {
        console.log(`  ✓ ${ch.tab}(으)로 전환`);
        sleep(2000);
      }
    } catch (tabErr) {
      console.error(`[dz] ${ch.label} 탭 전환 오류, 수집을 계속합니다: ${tabErr.message}`);
    }

    scrollLoad(port, 8);
    sleep(1000);

    stories = extractStories(port);
  } catch (err) {
    console.error(`[dz] ${ch.label} 페이지 로드 또는 추출 오류: ${err.message}`);
    return null;
  }

  if (!stories.length) {
    console.error(
      `[dz] 수집 실패: 작품 목록을 파싱하지 못했습니다(페이지 구조가 바뀌었거나 로드되지 않았을 수 있음). ${ch.url}을 직접 열어 페이지가 정상인지 확인하세요.`
    );
    return null;
  }

  // 품질 게이트: 작품명 적중률은 점중 수집의 성패를 판단하는 핵심 신호입니다.
  const titled = stories.filter((s) => s.title).length;
  const ratio = titled / stories.length;
  const quality = ratio < 0.5 ? "[书名解析异常]" : "[OK]";
  console.log(`  ✓ 提取 ${stories.length} 条（书名 ${titled}/${stories.length}）`);
  if (ratio < 0.5) {
    console.error(`  ⚠ 작품명 파싱률이 낮습니다(${titled}/${stories.length}). 결과에 품질 표시를 추가했습니다.`);
  }

  const now = new Date().toISOString();
  const lines = [
    `# 点众 · ${ch.label}短篇`,
    "",
    `- 来源：${ch.url}`,
    `- 抓取时间：${now}`,
    `- 条目数：${stories.length}`,
    `- 书名解析：${titled} / ${stories.length}`,
    `- 数据质量：${quality}`,
    "",
    "---",
    "",
  ];

  stories.forEach((s, i) => {
    try {
      lines.push(`### #${i + 1} ${s.title || "（书名待解析）"}`);
      const meta = [s.author, s.tag, s.status, s.words, s.score].filter(Boolean).join(" · ");
      if (meta) lines.push(`*${meta}*`);
      if (s.update) lines.push(`**最新：** ${s.update}`);
      if (s.url) lines.push(`[作品页](${s.url})`);
      if (s.desc) {
        lines.push("");
        lines.push(`> ${s.desc.substring(0, 150)}${s.desc.length > 150 ? "..." : ""}`);
      }
      lines.push("", "---", "");
    } catch (storyErr) {
      console.error(`[dz] ${ch.label} ${i + 1}번째 항목 처리 오류: ${storyErr.message}`);
      lines.push("", "---", "");
    }
  });

  return lines.join("\n");
}

function main() {
  const channels = CHANNEL === "all" ? CHANNELS.map((c) => c.id) : [CHANNEL];
  let written = 0;

  for (const ch of channels) {
    const content = scrapeChannel(PORT, ch);
    if (!content) continue;

    const chInfo = CHANNELS.find((c) => c.id === ch);
    const date = localDateStamp();
    const filename = `点众${chInfo.label}短篇_${date}.md`;
    fs.mkdirSync(OUTDIR, { recursive: true });
    const filepath = path.join(OUTDIR, filename);
    fs.writeFileSync(filepath, content, "utf-8");
    written++;
    console.log(`  ✓ 저장 완료: ${filepath}`);
  }
  return written;
}

if (require.main === module) {
  runCli(main, "점중 수집");
}

module.exports = { buildStoriesJS };
