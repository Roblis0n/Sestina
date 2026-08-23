export const RESEARCH_ROOM_CSS = String.raw`
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #18312c;
  background: #f3f0e8;
  font-synthesis: none;
  --ink: #18312c;
  --ink-soft: #53645f;
  --forest: #173f36;
  --forest-deep: #102f29;
  --paper: #fffdf8;
  --paper-soft: #f8f5ed;
  --line: #d9d3c5;
  --line-strong: #bdb5a5;
  --gold: #c58c32;
  --gold-soft: #f3e6c9;
  --danger: #8a3737;
  --shadow: 0 24px 70px rgb(23 63 54 / 10%), 0 4px 18px rgb(23 63 54 / 6%);
}
* { box-sizing: border-box; }
html { min-width: 320px; background: #f3f0e8; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at 8% 5%, rgb(255 255 255 / 90%) 0, transparent 32rem), linear-gradient(180deg, #f7f4ec 0, #efede6 100%); }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .5; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible { outline: 3px solid #d8a551; outline-offset: 3px; }
input, textarea, select { width: 100%; border: 1px solid var(--line-strong); border-radius: 10px; padding: .78rem .85rem; background: #fffefa; color: var(--ink); transition: border-color .16s ease, box-shadow .16s ease; }
input:hover, textarea:hover, select:hover { border-color: #8f9b96; }
input:focus, textarea:focus, select:focus { border-color: var(--forest); box-shadow: 0 0 0 4px rgb(23 63 54 / 9%); }
textarea { min-height: 8rem; resize: vertical; line-height: 1.55; }
label { display: block; margin: .9rem 0 .38rem; font-size: .88rem; font-weight: 720; letter-spacing: .01em; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
[hidden] { display: none !important; }

.app-bar { min-height: 72px; border-bottom: 1px solid rgb(189 181 165 / 70%); padding: 0 clamp(1rem, 4vw, 4rem); display: flex; align-items: center; justify-content: space-between; gap: 1rem; background: rgb(255 253 248 / 78%); backdrop-filter: blur(14px); }
.brand { display: flex; align-items: center; gap: .8rem; }
.brand-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; background: var(--forest); color: #fffaf0; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 15%); font-family: Georgia, serif; font-size: 1.22rem; font-weight: 700; }
.brand-copy strong { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 1.1rem; letter-spacing: .01em; }
.brand-copy span { display: block; margin-top: .08rem; color: var(--ink-soft); font-size: .74rem; letter-spacing: .04em; }
.local-status { display: inline-flex; align-items: center; gap: .45rem; padding: .45rem .7rem; border: 1px solid #c8d1cb; border-radius: 999px; background: #f5faf6; color: #315a4e; font-size: .78rem; font-weight: 700; }
.local-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #438565; box-shadow: 0 0 0 4px rgb(67 133 101 / 12%); }

main { width: min(1500px, 100%); margin: 0 auto; padding: clamp(1.25rem, 3vw, 2.5rem) clamp(1rem, 4vw, 4rem) 4rem; }
#live { min-height: 1.5rem; margin: 0 0 1rem; padding: .55rem .75rem; border-radius: 8px; color: var(--forest); font-size: .86rem; font-weight: 700; }
#live:empty { min-height: 0; margin: 0; padding: 0; }
#live[data-tone="working"] { background: #edf4f0; }
#live[data-tone="success"] { background: #e8f3ec; }
#live[data-tone="error"] { background: #fbebea; color: var(--danger); }

.launch-shell { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(420px, .92fr); gap: clamp(2rem, 6vw, 6.5rem); align-items: center; min-height: calc(100vh - 160px); }
.launch-intro { max-width: 710px; padding: 1rem 0 2rem; }
.eyebrow { margin: 0 0 1rem; color: #7d602c; font-size: .77rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
.launch-intro h1 { max-width: 660px; margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.6rem, 5.8vw, 5.1rem); font-weight: 500; line-height: .99; letter-spacing: -.045em; color: var(--forest-deep); }
.launch-deck { max-width: 610px; margin: 1.45rem 0 0; color: #52645f; font-size: clamp(1rem, 1.5vw, 1.16rem); line-height: 1.72; }
.privacy-row { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.55rem 0 0; }
.privacy-chip { display: inline-flex; align-items: center; gap: .42rem; padding: .48rem .68rem; border: 1px solid #d2cbbd; border-radius: 999px; background: rgb(255 253 248 / 66%); color: #49605a; font-size: .79rem; font-weight: 700; }
.privacy-chip::before { content: "✓"; color: #337259; font-weight: 900; }
.journey { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin-top: clamp(2rem, 5vw, 4rem); border-top: 1px solid var(--line); }
.journey-step { position: relative; padding: 1rem .75rem 0 0; color: #697772; }
.journey-step::before { content: ""; position: absolute; top: -4px; left: 0; width: 7px; height: 7px; border-radius: 50%; background: #a9b3af; }
.journey-step:first-child::before { background: var(--gold); box-shadow: 0 0 0 5px var(--gold-soft); }
.journey-step b { display: block; margin-bottom: .24rem; color: var(--forest); font-family: Georgia, serif; font-size: .98rem; }
.journey-step span { display: block; max-width: 10rem; font-size: .76rem; line-height: 1.45; }

.open-card { position: relative; overflow: hidden; border: 1px solid rgb(189 181 165 / 75%); border-radius: 22px; padding: clamp(1.35rem, 3vw, 2rem); background: rgb(255 253 248 / 94%); box-shadow: var(--shadow); }
.open-card::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg, var(--gold), #e4c582 55%, transparent); }
.open-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.open-card h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(1.55rem, 2.5vw, 2rem); font-weight: 550; letter-spacing: -.02em; }
.open-card-header p { margin: .55rem 0 0; color: var(--ink-soft); font-size: .88rem; line-height: 1.55; }
.step-number { flex: 0 0 auto; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #d5c6a8; border-radius: 50%; color: #8b6427; background: #fbf2dd; font-family: Georgia, serif; font-weight: 700; }
.primary-open { width: 100%; min-height: 84px; margin-top: 1.35rem; border: 0; border-radius: 14px; padding: 1rem 1.1rem; display: grid; grid-template-columns: 42px 1fr 24px; align-items: center; gap: .85rem; text-align: left; color: #fffdf6; background: linear-gradient(135deg, #19483d, #12352e); box-shadow: 0 10px 24px rgb(23 63 54 / 22%); transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
.primary-open:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 30px rgb(23 63 54 / 27%); background: linear-gradient(135deg, #205548, #153c34); }
.primary-open svg { width: 38px; height: 38px; padding: 8px; border-radius: 10px; background: rgb(255 255 255 / 10%); }
.button-copy strong { display: block; font-size: .98rem; letter-spacing: .005em; }
.button-copy small { display: block; margin-top: .25rem; color: #cadbd5; font-size: .75rem; font-weight: 500; line-height: 1.35; }
.button-arrow { font-size: 1.4rem; color: #e1bf73; transform: translateX(0); transition: transform .16s ease; }
.primary-open:hover .button-arrow { transform: translateX(3px); }
.zero-write { margin: .75rem 0 1.25rem; color: #66736f; font-size: .76rem; line-height: 1.5; }
.manual-panel { border-top: 1px solid var(--line); }
.manual-panel summary { cursor: pointer; padding: 1rem 0 .6rem; color: #39564e; font-size: .84rem; font-weight: 750; list-style: none; }
.manual-panel summary::-webkit-details-marker { display: none; }
.manual-panel summary::after { content: "+"; float: right; color: #8b6427; font-size: 1.1rem; }
.manual-panel[open] summary::after { content: "−"; }
.manual-panel p { margin: .15rem 0 .65rem; color: #6d7773; font-size: .77rem; line-height: 1.5; }
.manual-actions { display: flex; align-items: flex-end; gap: .6rem; }
.manual-actions .field { flex: 1; min-width: 0; }
.manual-actions label { margin-top: .25rem; }
.manual-open { flex: 0 0 auto; min-height: 44px; border: 1px solid var(--forest); border-radius: 10px; padding: .68rem .85rem; color: var(--forest); background: transparent; font-size: .83rem; font-weight: 750; }
.manual-open:hover:not(:disabled) { background: #edf3f0; }
.privacy-note { margin: 1.2rem 0 0; padding: .9rem 1rem; display: flex; gap: .7rem; border-radius: 11px; background: #f5f2e9; color: #5e6965; font-size: .76rem; line-height: 1.55; }
.privacy-note strong { color: var(--forest); }
.lock-mark { flex: 0 0 auto; color: #8b6427; font-size: 1rem; }

.card { border: 1px solid var(--line); border-radius: 17px; padding: 1.15rem; background: var(--paper); box-shadow: 0 5px 22px rgb(23 49 44 / 6%); }
.card h2, .card h3 { font-family: Georgia, "Times New Roman", serif; color: var(--forest-deep); }
.card h2 { margin: 0; font-size: 1.45rem; }
.card h3 { margin: 1.25rem 0 .45rem; font-size: 1.02rem; }
.setup { width: min(760px, 100%); margin: clamp(1rem, 5vw, 4rem) auto; padding: clamp(1.3rem, 3vw, 2rem); }
.setup-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--line); }
.setup-head p { margin: .55rem 0 0; }
.setup .primary-action { margin-top: 1rem; }
.muted { color: #65736e; font-size: .88rem; line-height: 1.55; }
.primary-action, .secondary, .danger { border-radius: 9px; padding: .67rem .85rem; font-weight: 720; }
.primary-action { border: 1px solid var(--forest); color: white; background: var(--forest); }
.primary-action:hover:not(:disabled) { background: var(--forest-deep); }
.secondary { border: 1px solid #8ea098; color: var(--forest); background: transparent; }
.secondary:hover:not(:disabled) { background: #edf3f0; }
.danger { border: 1px solid var(--danger); color: white; background: var(--danger); }
.room-topbar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: .2rem; }
.room-title h1 { margin: 0; font-family: Georgia, serif; color: var(--forest-deep); font-size: clamp(1.75rem, 3vw, 2.45rem); font-weight: 520; letter-spacing: -.025em; }
.room-title p { margin: .32rem 0 0; }
.change-project { border: 1px solid var(--line-strong); border-radius: 9px; padding: .58rem .75rem; color: #425a53; background: rgb(255 253 248 / 75%); font-size: .8rem; font-weight: 700; }
.change-project:hover { background: #fffdf8; border-color: #85948e; }
.grid { display: grid; grid-template-columns: minmax(18rem, .92fr) minmax(21rem, 1.16fr) minmax(18rem, .92fr); gap: 1rem; align-items: start; }
.state-card { border-top: 4px solid #b8904d; }
.review-card { border-top: 4px solid var(--forest); }
.receipts-column { border-top: 4px solid #879a92; }
.status { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .79rem; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-line; color: #52625d; }
.list { margin: .35rem 0 1rem; padding-left: 1.15rem; }
.list li { margin: .28rem 0; line-height: 1.45; }
.manifest { margin-top: 1rem; border-top: 1px solid var(--line); padding-top: 1rem; }
.manifest table { width: 100%; border-collapse: collapse; font-size: .79rem; }
.manifest th, .manifest td { text-align: left; padding: .42rem .32rem; border-bottom: 1px solid #e8e3d8; vertical-align: top; }
.manifest th { color: #53635d; font-size: .72rem; letter-spacing: .04em; }
.actions { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .9rem; }
.finding { border-left: 3px solid #5e8275; padding: .62rem .72rem; margin: .55rem 0; background: #f1f6f3; font-size: .87rem; line-height: 1.5; }
.receipt { border-top: 1px solid #e0dacd; padding: .8rem 0; }
.receipt:first-of-type { border-top: 0; }
.receipt button { margin: .3rem .25rem 0 0; padding: .45rem .6rem; font-size: .77rem; }
.file-field { margin-top: .65rem; padding: .75rem; border: 1px dashed #bcb7aa; border-radius: 10px; background: #faf8f2; }
.file-field label { margin-top: 0; }

@media (max-width: 1080px) {
  .launch-shell { grid-template-columns: 1fr; min-height: 0; gap: 1rem; }
  .launch-intro { max-width: none; padding-bottom: 1rem; }
  .launch-intro h1 { max-width: 780px; }
  .launch-deck { max-width: 720px; }
  .journey { margin-top: 2rem; }
  .open-card { width: min(680px, 100%); }
  .grid { grid-template-columns: 1fr 1fr; }
  .receipts-column { grid-column: 1 / -1; }
}
@media (max-width: 700px) {
  .app-bar { min-height: 62px; }
  .brand-copy span { display: none; }
  main { padding-top: 1.3rem; }
  .launch-intro h1 { font-size: clamp(2.25rem, 13vw, 3.5rem); }
  .journey-step span { display: none; }
  .open-card { border-radius: 17px; }
  .manual-actions { display: block; }
  .manual-open { width: 100%; margin-top: .55rem; }
  .grid { grid-template-columns: 1fr; }
  .receipts-column { grid-column: auto; }
  .room-topbar { align-items: flex-start; }
  .room-title h1 { font-size: 1.65rem; }
}
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
  <header class="app-bar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">S</span><div class="brand-copy"><strong>Sestina</strong><span>Research Deliberation Kernel</span></div></div>
    <span class="local-status">本机运行</span>
  </header>
  <main>
    <div id="live" role="status" aria-live="polite"></div>
    <section id="project-launch" class="launch-shell">
      <div class="launch-intro">
        <p class="eyebrow">Local Research Room</p>
        <h1>从一个研究项目开始</h1>
        <p class="launch-deck">选择你的研究文件夹。Sestina 会把研究问题、既有决定与本轮审议维持在同一条可追溯的研究主线上，而不是让你每次从空白聊天重新开始。</p>
        <div class="privacy-row" aria-label="本地隐私边界"><span class="privacy-chip">仅在本机</span><span class="privacy-chip">不扫描目录</span><span class="privacy-chip">不自动联网</span></div>
        <div class="journey" aria-label="使用步骤">
          <div class="journey-step"><b>01 选择项目</b><span>由你明确选择一个本地研究文件夹</span></div>
          <div class="journey-step"><b>02 建立 Brief</b><span>由你写下问题与当前最小任务</span></div>
          <div class="journey-step"><b>03 进入审议</b><span>围绕决定、证据与纠偏持续工作</span></div>
        </div>
      </div>
      <article class="open-card">
        <div class="open-card-header"><div><h2>打开研究项目</h2><p>首选系统文件夹窗口；选中普通文件夹时会自动完成本地初始化。</p></div><span class="step-number" aria-hidden="true">01</span></div>
        <button id="choose-folder" class="primary-open" type="button">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.75 6.75a2 2 0 0 1 2-2h4l2 2h6.5a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V6.75Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 9.5h16" stroke="currentColor" stroke-width="1.6"/></svg>
          <span class="button-copy"><strong>选择文件夹并打开</strong><small>打开 Windows 系统文件夹选择窗口</small></span><span class="button-arrow" aria-hidden="true">→</span>
        </button>
        <p class="zero-write">取消选择不会写入任何内容；系统不会记住或展示你的路径历史。</p>
        <details id="manual-mode" class="manual-panel">
          <summary><span>手动输入绝对路径</span></summary>
          <p>当系统窗口不可用或你已复制路径时使用。两种模式执行相同的打开与初始化规则。</p>
          <form id="project-form" class="manual-actions">
            <div class="field"><label for="project-path">项目绝对路径</label><input id="project-path" name="projectPath" required autocomplete="off" spellcheck="false" placeholder="D:\research\my-project"></div>
            <button id="manual-open" class="manual-open" type="submit">按此路径打开或初始化</button>
          </form>
        </details>
        <div class="privacy-note"><span class="lock-mark" aria-hidden="true">⌾</span><span><strong>本地边界：</strong>只会检查所选目录是否已有 <code>.sestina</code>。没有时仅创建项目状态；不会读取研究材料、上传目录内容或自动调用网络 Provider。</span></div>
      </article>
    </section>

    <section id="project-setup" class="card setup" hidden>
      <div class="setup-head"><div><p class="eyebrow">Research Brief</p><h2>建立这项研究的工作主线</h2><p class="muted">文件夹已就绪。研究问题和当前任务必须由你明确填写；Sestina 不会从目录内容或模型输出中替你编造。</p></div><span class="step-number" aria-hidden="true">02</span></div>
      <form id="brief-form">
        <label for="initial-question">研究问题</label>
        <textarea id="initial-question" required maxlength="4096" placeholder="这项研究当前真正需要回答什么？"></textarea>
        <label for="initial-task">当前最小研究任务</label>
        <textarea id="initial-task" required maxlength="4096" placeholder="接下来要完成的最小、可验证工作是什么？"></textarea>
        <button class="primary-action" type="submit">激活 Brief 并进入 Research Room</button>
      </form>
    </section>

    <section id="room" class="grid" hidden>
      <div class="room-topbar"><div class="room-title"><p class="eyebrow">Active Research Room</p><h1>围绕当前研究问题工作</h1><p class="muted" id="project-title"></p></div><button id="change-project" class="change-project" type="button">切换研究项目</button></div>
      <article class="card state-card">
        <h2>当前研究状态</h2>
        <h3>Research Brief</h3>
        <p><strong>问题：</strong><span id="question"></span></p>
        <p><strong>阶段：</strong><span id="stage"></span></p>
        <p><strong>当前任务：</strong><span id="task"></span></p>
        <h3>必须保留的决定</h3><ul id="fixed" class="list"></ul>
        <h3>已接受决定</h3><ul id="decisions" class="list"></ul>
        <h3>开放问题</h3><ul id="issues" class="list"></ul>
        <h3>当前 Episode</h3><p id="episode" class="status"></p>
      </article>
      <article class="card review-card">
        <h2>审议一个建议</h2>
        <p class="muted">一次只审议一项建议。先核对发送清单，再决定是否让 Provider 分析。</p>
        <form id="prepare-form">
          <label for="suggestion">单个建议</label>
          <textarea id="suggestion" required maxlength="16384" placeholder="粘贴本轮需要审议的一项建议"></textarea>
          <div class="file-field"><label for="suggestion-file">或读取一个本地文本文件</label><input id="suggestion-file" type="file" accept=".txt,.md,text/plain,text/markdown"><span class="muted">仅由浏览器读取你明确选中的一个文件，不扫描目录。</span></div>
          <label for="evidence-class">证据类别</label>
          <select id="evidence-class"><option value="owner_scenario">owner_scenario</option><option value="synthetic_fixture">synthetic_fixture</option><option value="synthetic_adversarial_fixture">synthetic_adversarial_fixture</option></select>
          <button class="primary-action" type="submit">先生成 Context Manifest</button>
        </form>
        <section id="manifest" class="manifest" hidden>
          <h3>Context Manifest（发送前）</h3>
          <p id="manifest-summary" class="status"></p>
          <table><thead><tr><th>字段</th><th>来源</th><th>敏感性</th></tr></thead><tbody id="manifest-fields"></tbody></table>
          <div class="actions"><button id="analyze" class="primary-action" type="button">我已核对，开始分析</button><button id="cancel-review" class="secondary" type="button">取消</button></div>
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
            <button class="primary-action" type="button" data-disposition="accepted">接受</button><button type="button" class="secondary" data-disposition="rejected">拒绝</button><button class="primary-action" type="button" data-disposition="modified_accepted">修改后接受</button><button type="button" class="secondary" data-disposition="deferred">暂缓</button><button type="button" class="danger" data-disposition="direction_changed">正式改向</button>
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
const live = (message, tone = "success") => { $("live").textContent = message; $("live").dataset.tone = tone; };
const escapeText = (value) => document.createTextNode(String(value));
async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.mutation ? { "x-sestina-session": token } : {}) };
  const response = await fetch(path, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const value = await response.json();
  if (!response.ok || value.ok !== true) throw new Error(value.error?.message || "请求失败");
  return value.value;
}
async function whileBusy(button, message, action) {
  button.disabled = true; button.setAttribute("aria-busy", "true"); live(message, "working");
  try { return await action(); } finally { button.disabled = false; button.removeAttribute("aria-busy"); }
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
async function presentOpened(opened) {
  projectId = opened.project.id; $("project-form").reset(); $("project-launch").hidden = true; $("room").hidden = true;
  $("project-setup").hidden = !opened.setupRequired;
  if (opened.setupRequired) {
    live(opened.initialized ? "已在所选文件夹完成本地初始化。请建立初始 Research Brief。" : "项目已打开，但还需要建立初始 Research Brief。", "success");
  } else {
    await refresh(); live("研究项目已在本机打开；路径不会写入凭证或日志。", "success");
  }
}
async function downloadReceipt(id) {
  try { const response = await fetch("/api/receipts/" + encodeURIComponent(id) + "/download", { headers: { "x-sestina-session": token } }); if (!response.ok) throw new Error("下载失败"); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = id + ".json"; link.click(); URL.revokeObjectURL(url); live("凭证下载已由你显式启动。", "success"); } catch (error) { live(error.message, "error"); }
}
async function rollbackReceipt(receipt) {
  const reason = window.prompt("请输入回滚理由。此动作会创建新的版本化状态。", "撤销本次用户处置。"); if (!reason) return;
  try { await api("/api/receipts/" + encodeURIComponent(receipt.id) + "/rollback", { method: "POST", mutation: true, body: { expectedVersion: receipt.version, reason } }); await refresh(); live("已回滚，并保留可审计凭证。", "success"); } catch (error) { live(error.message, "error"); }
}
$("choose-folder").addEventListener("click", async () => {
  try {
    const opened = await whileBusy($("choose-folder"), "正在等待你在系统窗口中选择文件夹……", () => api("/api/project/select-directory", { method: "POST", mutation: true, body: {} }));
    if (!opened.selected) { live("你已取消选择；没有写入或初始化任何内容。", "success"); return; }
    await presentOpened(opened);
  } catch (error) { $("manual-mode").open = true; live(error.message + " 你仍可使用下方绝对路径方式。", "error"); }
});
$("project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { const opened = await whileBusy($("manual-open"), "正在打开或初始化指定项目……", () => api("/api/project/open", { method: "POST", mutation: true, body: { projectPath: $("project-path").value, initializeIfNeeded: true } })); await presentOpened(opened); }
  catch (error) { live(error.message, "error"); }
});
$("brief-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const submit = event.submitter; const state = await whileBusy(submit, "正在建立 Research Brief……", () => api("/api/project/brief", { method: "POST", mutation: true, body: { projectQuestion: $("initial-question").value, currentTask: $("initial-task").value } }));
    $("project-setup").hidden = true; showState(state); live("Research Brief 已由你激活；现在可以围绕这项研究继续工作。", "success");
  } catch (error) { live(error.message, "error"); }
});
$("change-project").addEventListener("click", () => { $("room").hidden = true; $("project-setup").hidden = true; $("project-launch").hidden = false; live("请选择另一个研究项目；当前项目状态仍保留在原文件夹中。", "success"); });
$("suggestion-file").addEventListener("change", async () => { const file = $("suggestion-file").files[0]; if (!file) return; if (file.size > 16384) return live("文件超过 16 KiB 限制。", "error"); $("suggestion").value = await file.text(); live("只读取了你明确选中的一个文件。", "success"); });
$("prepare-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { prepared = await api("/api/reviews/prepare", { method: "POST", mutation: true, body: { suggestion: $("suggestion").value, evidenceClass: $("evidence-class").value } }); analyzed = undefined; $("analysis").hidden = true; $("manifest").hidden = false; const m = prepared.manifest; $("manifest-summary").textContent = "Provider: " + m.providerId + " · 网络需求: " + m.networkRequired + " · 当前未发送 · 外部证据计数: false"; const body = $("manifest-fields"); body.replaceChildren(); for (const field of m.fields) { const row = document.createElement("tr"); for (const value of [field.category, field.source, field.sensitivity]) { const td = document.createElement("td"); td.textContent = value; row.append(td); } body.append(row); } live("Context Manifest 已生成。核对后才会调用 Provider。", "success"); } catch (error) { live(error.message, "error"); }
});
$("cancel-review").onclick = () => { prepared = undefined; analyzed = undefined; $("manifest").hidden = true; $("analysis").hidden = true; live("本次审议已在发送前取消。", "success"); };
$("analyze").onclick = async () => {
  if (!prepared) return;
  try { analyzed = await api("/api/reviews/analyze", { method: "POST", mutation: true, body: { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash } }); $("analysis").hidden = false; $("provider-status").textContent = analyzed.providerStatus + (analyzed.ledgerOnlyReason ? " · " + analyzed.ledgerOnlyReason : ""); const findings = $("findings"); findings.replaceChildren(); for (const finding of analyzed.analysis.findings) { const div = document.createElement("div"); div.className = "finding"; div.textContent = finding.kind + " — " + finding.summary; findings.append(div); } $("delta").textContent = analyzed.analysis.argumentDelta.genuineAdditions.join("；") || analyzed.analysis.argumentDelta.summary; $("alternatives").textContent = analyzed.analysis.alternativeExplanations.join("；"); $("unproven").textContent = analyzed.analysis.unproven.join("；"); $("correction").textContent = analyzed.analysis.minimalCorrection; for (const button of $("dispositions").querySelectorAll("button")) button.disabled = analyzed.providerStatus === "ledger_only" && !["rejected", "deferred"].includes(button.dataset.disposition); live("分析已返回。模型不能替你作出处置。", "success"); } catch (error) { live(error.message, "error"); }
};
for (const button of $("dispositions").querySelectorAll("button")) button.addEventListener("click", async () => {
  if (!analyzed) return; const disposition = button.dataset.disposition; const modifiedNeeded = disposition === "modified_accepted"; const redirectNeeded = disposition === "direction_changed"; $("modified").hidden = $("modified-label").hidden = !modifiedNeeded; $("redirect").hidden = $("redirect-label").hidden = !redirectNeeded;
  if (modifiedNeeded && !$("modified").value.trim()) return live("请先填写修改后建议，再次点击“修改后接受”。", "error"); if (redirectNeeded && !$("redirect").value.trim()) return live("请先填写新的正式研究问题，再次点击“正式改向”。", "error"); if (!$("reason").value.trim()) return live("请填写你的处置理由。", "error");
  try { await api("/api/reviews/commit", { method: "POST", mutation: true, body: { projectId, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition, reason: $("reason").value, ...(modifiedNeeded ? { modifiedProposal: $("modified").value } : {}), ...(redirectNeeded ? { redirectQuestion: $("redirect").value } : {}) } }); prepared = undefined; analyzed = undefined; $("manifest").hidden = true; $("analysis").hidden = true; $("prepare-form").reset(); $("reason").value = ""; $("modified").value = ""; $("redirect").value = ""; await refresh(); live("你的处置已提交，并生成版本化 Episode 凭证。", "success"); } catch (error) { live(error.message, "error"); }
});
(async () => {
  try { const status = await api("/api/status"); token = status.sessionToken; if (!status.directoryPickerAvailable) { $("choose-folder").disabled = true; $("manual-mode").open = true; live("当前环境不能打开系统文件夹窗口，请使用绝对路径方式。", "error"); } else { live("本地服务已就绪；选择一个研究文件夹即可开始。", "success"); } }
  catch { live("本地服务不可用。", "error"); }
})();
`;
