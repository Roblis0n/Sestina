export const RESEARCH_ROOM_CSS = String.raw`
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17212b; background: #f7f5ef; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; border: 1px solid #173d35; border-radius: 8px; padding: .65rem .9rem; background: #173d35; color: white; }
button.secondary { background: transparent; color: #173d35; }
button.danger { background: #762f2f; border-color: #762f2f; }
button:disabled { cursor: not-allowed; opacity: .48; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible { outline: 3px solid #d49b35; outline-offset: 2px; }
input, textarea, select { width: 100%; border: 1px solid #a5aaa8; border-radius: 7px; padding: .65rem; background: white; color: inherit; }
textarea { min-height: 8rem; resize: vertical; }
label { display: block; font-weight: 650; margin: .8rem 0 .35rem; }
header { border-bottom: 1px solid #d7d2c5; padding: 1.1rem clamp(1rem, 4vw, 3.2rem); display: flex; align-items: baseline; gap: 1rem; }
header h1 { margin: 0; font-family: Georgia, serif; font-size: clamp(1.5rem, 3vw, 2.2rem); }
header p { margin: 0; color: #57615f; }
main { padding: 1rem clamp(1rem, 4vw, 3.2rem) 3rem; max-width: 1500px; margin: auto; }
.notice { border-left: 4px solid #d49b35; padding: .7rem 1rem; margin: 0 0 1rem; background: #fffaf0; }
.project-open { display: grid; grid-template-columns: minmax(16rem, 1fr) auto; gap: .75rem; align-items: end; margin-bottom: 1rem; }
.project-open label { margin-top: 0; }
.setup { max-width: 760px; margin: 0 auto 1rem; }
.grid { display: grid; grid-template-columns: minmax(18rem, 1fr) minmax(19rem, 1fr) minmax(18rem, 1fr); gap: 1rem; align-items: start; }
.card { border: 1px solid #d7d2c5; border-radius: 12px; padding: 1rem; background: #fff; box-shadow: 0 2px 10px rgb(23 33 43 / 5%); }
.card h2, .card h3 { margin-top: 0; font-family: Georgia, serif; }
.muted { color: #66706e; font-size: .92rem; }
.status { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .86rem; overflow-wrap: anywhere; }
.pill { display: inline-block; border: 1px solid #8b938f; border-radius: 999px; padding: .15rem .5rem; font-size: .8rem; margin: .1rem .15rem .1rem 0; }
.list { margin: .4rem 0 1rem; padding-left: 1.2rem; }
.manifest { margin-top: 1rem; border-top: 1px solid #ddd7c9; padding-top: 1rem; }
.manifest table { width: 100%; border-collapse: collapse; font-size: .85rem; }
.manifest th, .manifest td { text-align: left; padding: .35rem; border-bottom: 1px solid #e7e3da; vertical-align: top; }
.actions { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .8rem; }
.finding { border-left: 3px solid #587b6e; padding: .55rem .7rem; margin: .5rem 0; background: #f5f8f6; }
.receipt { border-top: 1px solid #ddd7c9; padding: .75rem 0; }
.receipt:first-of-type { border-top: 0; }
.receipt button { padding: .4rem .6rem; font-size: .84rem; }
[hidden] { display: none !important; }
#live { min-height: 1.5rem; margin: .5rem 0; font-weight: 650; }
@media (max-width: 1000px) { .grid { grid-template-columns: 1fr 1fr; } .receipts-column { grid-column: 1 / -1; } }
@media (max-width: 680px) { .grid, .project-open { grid-template-columns: 1fr; } header { display: block; } header p { margin-top: .35rem; } }
`;

export const RESEARCH_ROOM_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sestina Research Room</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <header><h1>Sestina Research Room</h1><p>围绕当前研究问题工作，而不是从空白聊天开始</p></header>
  <main>
    <p class="notice">默认仅在本机运行。点击“打开或初始化项目”后，如果所选目录还不是 Sestina 项目，会只在该目录创建本地 <code>.sestina</code>；不会扫描目录内容，也不会联网。Context 外发、提交处置、下载凭证和回滚仍需要你的显式动作。</p>
    <form id="project-form" class="project-open">
      <div><label for="project-path">项目目录</label><input id="project-path" name="projectPath" required autocomplete="off" placeholder="D:\\path\\to\\project"></div>
      <button type="submit">打开或初始化项目</button>
    </form>
    <div id="live" role="status" aria-live="polite"></div>
    <section id="project-setup" class="card setup" hidden>
      <h2>完成初始 Research Brief</h2>
      <p class="muted">本地项目已经建立。研究问题和当前任务必须由你填写；Sestina 不会根据目录内容或模型输出替你编造。</p>
      <form id="brief-form">
        <label for="initial-question">研究问题</label>
        <textarea id="initial-question" required maxlength="4096" placeholder="你当前真正要回答的研究问题"></textarea>
        <label for="initial-task">当前研究任务</label>
        <textarea id="initial-task" required maxlength="4096" placeholder="接下来需要完成的最小研究工作"></textarea>
        <button type="submit">激活并进入 Research Room</button>
      </form>
    </section>
    <section id="room" class="grid" hidden>
      <article class="card">
        <h2>当前研究状态</h2>
        <p class="muted" id="project-title"></p>
        <h3>Research Brief</h3>
        <p><strong>问题：</strong><span id="question"></span></p>
        <p><strong>阶段：</strong><span id="stage"></span></p>
        <p><strong>当前任务：</strong><span id="task"></span></p>
        <h3>必须保留的决定</h3><ul id="fixed" class="list"></ul>
        <h3>已接受决定</h3><ul id="decisions" class="list"></ul>
        <h3>开放问题</h3><ul id="issues" class="list"></ul>
        <h3>当前 Episode</h3><p id="episode" class="status"></p>
      </article>
      <article class="card">
        <h2>审议一个建议</h2>
        <form id="prepare-form">
          <label for="suggestion">单个建议</label>
          <textarea id="suggestion" required maxlength="16384" placeholder="粘贴本轮需要审议的一项建议"></textarea>
          <label for="suggestion-file">或从一个本地文本文件读取（仅浏览器读取，不扫描目录）</label>
          <input id="suggestion-file" type="file" accept=".txt,.md,text/plain,text/markdown">
          <label for="evidence-class">证据类别</label>
          <select id="evidence-class"><option value="owner_scenario">owner_scenario</option><option value="synthetic_fixture">synthetic_fixture</option><option value="synthetic_adversarial_fixture">synthetic_adversarial_fixture</option></select>
          <button type="submit">先生成 Context Manifest</button>
        </form>
        <section id="manifest" class="manifest" hidden>
          <h3>Context Manifest（发送前）</h3>
          <p id="manifest-summary" class="status"></p>
          <table><thead><tr><th>字段</th><th>来源</th><th>敏感性</th></tr></thead><tbody id="manifest-fields"></tbody></table>
          <div class="actions"><button id="analyze" type="button">我已核对，开始分析</button><button id="cancel-review" class="secondary" type="button">取消</button></div>
        </section>
        <section id="analysis" class="manifest" hidden>
          <h3>分析结果</h3><p id="provider-status" class="status"></p>
          <div id="findings"></div>
          <p><strong>真正增加：</strong><span id="delta"></span></p>
          <p><strong>替代解释：</strong><span id="alternatives"></span></p>
          <p><strong>未证明：</strong><span id="unproven"></span></p>
          <p><strong>最小纠正：</strong><span id="correction"></span></p>
          <label for="reason">你的处置理由</label><textarea id="reason" required maxlength="4096"></textarea>
          <label for="modified" id="modified-label" hidden>修改后建议</label><textarea id="modified" maxlength="16384" hidden></textarea>
          <label for="redirect" id="redirect-label" hidden>新的正式研究问题</label><textarea id="redirect" maxlength="4096" hidden></textarea>
          <div class="actions" id="dispositions">
            <button type="button" data-disposition="accepted">接受</button><button type="button" class="secondary" data-disposition="rejected">拒绝</button><button type="button" data-disposition="modified_accepted">修改后接受</button><button type="button" class="secondary" data-disposition="deferred">暂缓</button><button type="button" class="danger" data-disposition="direction_changed">正式改向</button>
          </div>
        </section>
      </article>
      <article class="card receipts-column"><h2>Episode 凭证</h2><p class="muted">只保存结构化理由、状态绑定与用户处置，不保存隐藏思维链或 Provider 原始响应。</p><div id="receipts"></div></article>
    </section>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>`;

export const RESEARCH_ROOM_JS = String.raw`
const $ = (id) => document.getElementById(id);
let token = "", projectId = "", prepared, analyzed;
const live = (message, failed = false) => { $("live").textContent = message; $("live").style.color = failed ? "#762f2f" : "#173d35"; };
const escapeText = (value) => document.createTextNode(String(value));
async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.mutation ? { "x-sestina-session": token } : {}) };
  const response = await fetch(path, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const value = await response.json();
  if (!response.ok || value.ok !== true) throw new Error(value.error?.message || "请求失败");
  return value.value;
}
function list(id, values, render) { const root = $(id); root.replaceChildren(); for (const value of values) { const li = document.createElement("li"); li.append(escapeText(render(value))); root.append(li); } if (!values.length) { const li = document.createElement("li"); li.append(escapeText("无")); root.append(li); } }
function showState(state) {
  projectId = state.project.id; $("room").hidden = false; $("project-title").textContent = state.project.title;
  $("question").textContent = state.brief.projectQuestion; $("stage").textContent = state.brief.currentStage; $("task").textContent = state.brief.currentTask;
  list("fixed", state.brief.fixedDecisions, x => x.statement); list("decisions", state.decisions, x => x.statement + " [" + x.status + "]"); list("issues", state.issues, x => x.summary + " [" + x.status + "]");
  $("episode").textContent = state.currentEpisode ? state.currentEpisode.id + " · " + state.currentEpisode.status : "无当前 Episode";
  showReceipts(state.receipts);
}
function showReceipts(receipts) {
  const root = $("receipts"); root.replaceChildren();
  if (!receipts.length) { root.textContent = "还没有凭证。"; return; }
  for (const receipt of receipts) {
    const item = document.createElement("section"); item.className = "receipt";
    const title = document.createElement("strong"); title.textContent = receipt.disposition.kind + " · " + receipt.status; item.append(title);
    const info = document.createElement("p"); info.className = "status"; info.textContent = receipt.id + "\n" + receipt.receiptHash; item.append(info);
    const download = document.createElement("button"); download.type = "button"; download.className = "secondary"; download.textContent = "下载凭证"; download.onclick = () => downloadReceipt(receipt.id); item.append(download);
    if (receipt.rollback.available) { const rollback = document.createElement("button"); rollback.type = "button"; rollback.className = "danger"; rollback.textContent = "回滚"; rollback.onclick = () => rollbackReceipt(receipt); item.append(rollback); }
    root.append(item);
  }
}
async function refresh() { showState(await api("/api/state")); }
async function downloadReceipt(id) {
  try { const response = await fetch("/api/receipts/" + encodeURIComponent(id) + "/download", { headers: { "x-sestina-session": token } }); if (!response.ok) throw new Error("下载失败"); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = id + ".json"; link.click(); URL.revokeObjectURL(url); live("凭证下载已由你显式启动。"); } catch (error) { live(error.message, true); }
}
async function rollbackReceipt(receipt) {
  const reason = window.prompt("请输入回滚理由。此动作会创建新的版本化状态。", "撤销本次用户处置。"); if (!reason) return;
  try { await api("/api/receipts/" + encodeURIComponent(receipt.id) + "/rollback", { method: "POST", mutation: true, body: { expectedVersion: receipt.version, reason } }); await refresh(); live("已回滚，并保留可审计凭证。"); } catch (error) { live(error.message, true); }
}
$("project-form").addEventListener("submit", async (event) => {
  event.preventDefault(); live("正在打开或初始化所选项目……");
  try {
    const opened = await api("/api/project/open", { method: "POST", mutation: true, body: { projectPath: $("project-path").value, initializeIfNeeded: true } });
    projectId = opened.project.id;
    $("room").hidden = true;
    $("project-setup").hidden = !opened.setupRequired;
    if (opened.setupRequired) {
      live(opened.initialized ? "已在所选目录创建本地 Sestina 项目。请在本页填写初始 Research Brief。" : "项目已打开，但初始 Research Brief 尚未完成。请在本页填写。");
    } else {
      await refresh(); live("项目已在本机打开。路径不会写入凭证或日志。");
    }
  } catch (error) { live(error.message, true); }
});
$("brief-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const state = await api("/api/project/brief", { method: "POST", mutation: true, body: { projectQuestion: $("initial-question").value, currentTask: $("initial-task").value } });
    $("project-setup").hidden = true;
    showState(state);
    live("初始 Research Brief 已由你激活；现在可以在 Research Room 中继续工作。");
  } catch (error) { live(error.message, true); }
});
$("suggestion-file").addEventListener("change", async () => { const file = $("suggestion-file").files[0]; if (!file) return; if (file.size > 16384) return live("文件超过 16 KiB 限制。", true); $("suggestion").value = await file.text(); live("只读取了你选中的一个文件。"); });
$("prepare-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { prepared = await api("/api/reviews/prepare", { method: "POST", mutation: true, body: { suggestion: $("suggestion").value, evidenceClass: $("evidence-class").value } }); analyzed = undefined; $("analysis").hidden = true; $("manifest").hidden = false; const m = prepared.manifest; $("manifest-summary").textContent = "Provider: " + m.providerId + " · 网络需求: " + m.networkRequired + " · 当前未发送 · 外部证据计数: false"; const body = $("manifest-fields"); body.replaceChildren(); for (const field of m.fields) { const row = document.createElement("tr"); for (const value of [field.category, field.source, field.sensitivity]) { const td = document.createElement("td"); td.textContent = value; row.append(td); } body.append(row); } live("Context Manifest 已生成。核对后才会调用 Provider。"); } catch (error) { live(error.message, true); }
});
$("cancel-review").onclick = () => { prepared = undefined; analyzed = undefined; $("manifest").hidden = true; $("analysis").hidden = true; live("本次审议已在发送前取消。"); };
$("analyze").onclick = async () => {
  if (!prepared) return;
  try { analyzed = await api("/api/reviews/analyze", { method: "POST", mutation: true, body: { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash } }); $("analysis").hidden = false; $("provider-status").textContent = analyzed.providerStatus + (analyzed.ledgerOnlyReason ? " · " + analyzed.ledgerOnlyReason : ""); const findings = $("findings"); findings.replaceChildren(); for (const finding of analyzed.analysis.findings) { const div = document.createElement("div"); div.className = "finding"; div.textContent = finding.kind + " — " + finding.summary; findings.append(div); } $("delta").textContent = analyzed.analysis.argumentDelta.genuineAdditions.join("；") || analyzed.analysis.argumentDelta.summary; $("alternatives").textContent = analyzed.analysis.alternativeExplanations.join("；"); $("unproven").textContent = analyzed.analysis.unproven.join("；"); $("correction").textContent = analyzed.analysis.minimalCorrection; for (const button of $("dispositions").querySelectorAll("button")) button.disabled = analyzed.providerStatus === "ledger_only" && !["rejected", "deferred"].includes(button.dataset.disposition); live("分析已返回。模型不能替你作出处置。"); } catch (error) { live(error.message, true); }
};
for (const button of $("dispositions").querySelectorAll("button")) button.addEventListener("click", async () => {
  if (!analyzed) return; const disposition = button.dataset.disposition; const modifiedNeeded = disposition === "modified_accepted"; const redirectNeeded = disposition === "direction_changed"; $("modified").hidden = $("modified-label").hidden = !modifiedNeeded; $("redirect").hidden = $("redirect-label").hidden = !redirectNeeded;
  if (modifiedNeeded && !$("modified").value.trim()) return live("请先填写修改后建议，再次点击“修改后接受”。", true); if (redirectNeeded && !$("redirect").value.trim()) return live("请先填写新的正式研究问题，再次点击“正式改向”。", true); if (!$("reason").value.trim()) return live("请填写你的处置理由。", true);
  try { await api("/api/reviews/commit", { method: "POST", mutation: true, body: { projectId, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition, reason: $("reason").value, ...(modifiedNeeded ? { modifiedProposal: $("modified").value } : {}), ...(redirectNeeded ? { redirectQuestion: $("redirect").value } : {}) } }); prepared = undefined; analyzed = undefined; $("manifest").hidden = true; $("analysis").hidden = true; $("prepare-form").reset(); $("reason").value = ""; $("modified").value = ""; $("redirect").value = ""; await refresh(); live("你的处置已提交，并生成版本化 Episode 凭证。"); } catch (error) { live(error.message, true); }
});
(async () => { try { const status = await api("/api/status"); token = status.sessionToken; live("本地服务已就绪；尚未打开任何项目。"); } catch { live("本地服务不可用。", true); } })();
`;
