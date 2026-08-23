export const RESEARCH_ROOM_CSS = String.raw`
:root {
  color-scheme: light;
  font-family: "Segoe UI Variable", "Segoe UI", Arial, sans-serif;
  color: #202824;
  background: #e8e7e1;
  font-synthesis: none;
  --ink: #202824;
  --muted: #66706a;
  --forest: #183e34;
  --forest-2: #24584a;
  --paper: #f8f7f2;
  --paper-2: #efeee8;
  --line: #c7c8c1;
  --line-dark: #909790;
  --amber: #b67923;
  --danger: #923e39;
  --ease: cubic-bezier(.22, .72, .24, 1);
}
* { box-sizing: border-box; }
html { min-width: 980px; background: #e8e7e1; }
body { margin: 0; min-width: 980px; min-height: 100vh; background: #e8e7e1; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .48; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid #d49a43; outline-offset: 3px; }
input, textarea, select { width: 100%; border: 1px solid var(--line-dark); border-radius: 2px; padding: .72rem .78rem; background: #fff; color: var(--ink); transition: border-color .16s ease, box-shadow .16s ease; }
input:hover, textarea:hover, select:hover { border-color: #5f6e67; }
input:focus, textarea:focus, select:focus { border-color: var(--forest); box-shadow: inset 3px 0 0 var(--forest); }
textarea { min-height: 7.5rem; resize: vertical; line-height: 1.55; }
label { display: block; margin: .9rem 0 .35rem; color: #29332e; font-size: .79rem; font-weight: 700; letter-spacing: .02em; }
code { font-family: Consolas, "SFMono-Regular", monospace; }
[hidden] { display: none !important; }

.topbar { height: 58px; padding: 0 28px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #122d27; background: #18382f; color: #f4f3ed; }
.brand { display: flex; align-items: center; gap: 11px; }
.brand-mark { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid rgb(255 255 255 / 42%); color: #fff; font-family: Georgia, serif; font-size: .95rem; }
.brand-copy { display: flex; align-items: baseline; gap: 10px; }
.brand-copy strong { font-family: Georgia, "Times New Roman", serif; font-size: 1.04rem; letter-spacing: .02em; }
.brand-copy span { color: #bfcfc8; font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; }
.topbar-tools { display: flex; align-items: center; gap: 18px; }
.connection { display: inline-flex; align-items: center; gap: 7px; color: #cbd7d2; font-size: .73rem; }
.connection-dot { width: 7px; height: 7px; border-radius: 50%; background: #75af92; box-shadow: 0 0 0 3px rgb(117 175 146 / 13%); }
.language-controls { display: flex; align-items: center; gap: 5px; border-left: 1px solid rgb(255 255 255 / 20%); padding-left: 16px; }
.language-toggle { min-width: 34px; border: 0; padding: 5px 6px; color: #b8c7c1; background: transparent; font-size: .73rem; font-weight: 650; }
.language-toggle:hover { color: #fff; }
.language-toggle[aria-pressed="true"] { color: #fff; box-shadow: inset 0 -1px 0 #d7ad69; }
.language-divider { color: #677d75; font-size: .7rem; }
.activity-line { position: fixed; z-index: 20; top: 58px; left: 0; right: 0; height: 2px; overflow: hidden; pointer-events: none; }
.activity-line::after { content: ""; display: block; width: 30%; height: 100%; background: #d19a46; transform: translateX(-110%); }
body[data-busy="true"] .activity-line::after { animation: activity 1.05s var(--ease) infinite; }

main { width: min(1440px, 100%); margin: 0 auto; padding: 0 28px 42px; }
#live { min-height: 34px; margin: 14px 0 4px; padding: 8px 11px; border-left: 2px solid transparent; color: var(--forest); font-size: .77rem; font-weight: 650; transition: opacity .18s ease, transform .18s ease; }
#live:empty { min-height: 18px; padding: 0; }
#live[data-tone="working"] { border-color: var(--amber); background: #f1ede4; }
#live[data-tone="success"] { border-color: #58816f; background: #e6ece7; }
#live[data-tone="error"] { border-color: var(--danger); color: var(--danger); background: #f2e6e3; }

.language-screen { min-height: calc(100vh - 110px); display: grid; grid-template-columns: minmax(420px, 1fr) minmax(460px, .82fr); align-items: stretch; border-left: 1px solid var(--line); border-right: 1px solid var(--line); background: var(--paper); animation: view-in .48s var(--ease) both; }
.language-context { position: relative; padding: clamp(58px, 7vw, 106px) clamp(52px, 7vw, 104px); display: flex; flex-direction: column; justify-content: space-between; border-right: 1px solid var(--line); background: #eeede7; }
.language-context::before { content: ""; position: absolute; top: 0; left: clamp(52px, 7vw, 104px); width: 1px; height: 42px; background: var(--amber); animation: draw-down .7s .18s var(--ease) both; }
.setup-index { color: #876329; font-family: Consolas, monospace; font-size: .72rem; letter-spacing: .12em; }
.language-context h1 { max-width: 670px; margin: 24px 0 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.5rem, 4.5vw, 4.5rem); font-weight: 400; line-height: 1.08; letter-spacing: -.035em; }
.language-context p { max-width: 620px; margin: 26px 0 0; color: #59635e; font-size: .98rem; line-height: 1.8; }
.language-principle { max-width: 590px; padding-top: 18px; border-top: 1px solid var(--line); color: #6b746f; font-size: .72rem; line-height: 1.65; }
.language-principle strong { color: var(--forest); }
.language-picker { padding: clamp(58px, 7vw, 106px) clamp(46px, 6vw, 88px); display: flex; flex-direction: column; justify-content: center; }
.language-picker h2 { margin: 0 0 8px; font-family: Georgia, "Times New Roman", serif; font-size: 1.7rem; font-weight: 400; }
.language-picker > p { margin: 0 0 34px; color: var(--muted); font-size: .8rem; line-height: 1.55; }
.language-choice { width: 100%; min-height: 92px; padding: 17px 0; display: grid; grid-template-columns: 42px 1fr 28px; align-items: center; gap: 14px; border: 0; border-top: 1px solid var(--line); color: var(--ink); background: transparent; text-align: left; transition: color .18s ease, padding-left .22s var(--ease), background .18s ease; }
.language-choice:last-of-type { border-bottom: 1px solid var(--line); }
.language-choice:hover:not(:disabled) { padding-left: 10px; color: var(--forest); background: #f0f2ed; }
.language-choice .choice-code { color: #8a6b39; font-family: Consolas, monospace; font-size: .72rem; }
.language-choice strong { display: block; font-family: Georgia, serif; font-size: 1.28rem; font-weight: 500; }
.language-choice small { display: block; margin-top: 5px; color: var(--muted); font-size: .73rem; }
.language-choice .choice-arrow { color: var(--amber); font-size: 1.2rem; transition: transform .2s var(--ease); }
.language-choice:hover .choice-arrow { transform: translateX(5px); }
.language-storage-note { margin-top: 28px; display: grid; grid-template-columns: 18px 1fr; gap: 9px; color: #67706b; font-size: .7rem; line-height: 1.6; }
.language-storage-note b { color: var(--forest); }

.workspace { border: 1px solid var(--line); background: var(--paper); animation: view-in .42s var(--ease) both; }
.workspace-header { min-height: 126px; padding: 25px 30px 22px; display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; border-bottom: 1px solid var(--line); }
.workspace-heading { display: grid; grid-template-columns: 54px 1fr; gap: 18px; align-items: start; }
.section-number { color: #8a6830; font-family: Consolas, monospace; font-size: .72rem; letter-spacing: .08em; padding-top: 7px; }
.workspace-heading h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2.35rem; font-weight: 400; letter-spacing: -.025em; }
.workspace-heading p { max-width: 690px; margin: 8px 0 0; color: var(--muted); font-size: .82rem; line-height: 1.6; }
.workspace-state { min-width: 210px; padding: 10px 0 3px; border-top: 1px solid var(--line-dark); color: #59645e; font-size: .7rem; line-height: 1.55; }
.workspace-state b { display: block; color: var(--forest); font-size: .75rem; }
.entry-grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 530px; }
.workflow-rail { padding: 28px 26px; border-right: 1px solid var(--line); background: #efeee8; }
.rail-label { margin: 0 0 24px; color: #6a746f; font-family: Consolas, monospace; font-size: .67rem; letter-spacing: .11em; text-transform: uppercase; }
.workflow-list { margin: 0; padding: 0; list-style: none; }
.workflow-item { position: relative; min-height: 78px; padding: 1px 0 22px 34px; color: #7a817d; border-left: 1px solid #bfc3bd; }
.workflow-item:last-child { border-left-color: transparent; }
.workflow-item::before { content: ""; position: absolute; left: -4px; top: 1px; width: 7px; height: 7px; border-radius: 50%; background: #aeb4af; }
.workflow-item.active::before { background: var(--amber); box-shadow: 0 0 0 5px #e5d7bc; animation: marker-pulse 2.2s ease-in-out infinite; }
.workflow-item b { display: block; margin-bottom: 5px; color: #2f3934; font-family: Georgia, serif; font-size: .92rem; }
.workflow-item span { display: block; font-size: .69rem; line-height: 1.45; }
.privacy-ledger { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--line); }
.privacy-ledger div { display: grid; grid-template-columns: 16px 1fr; gap: 8px; margin: 10px 0; color: #59635e; font-size: .7rem; }
.privacy-ledger div::before { content: "—"; color: #9a6e2a; }
.entry-main { padding: 38px clamp(40px, 6vw, 84px); }
.entry-main h2 { margin: 0; font-family: Georgia, serif; font-size: 1.45rem; font-weight: 400; }
.entry-main > p { max-width: 700px; margin: 9px 0 28px; color: var(--muted); font-size: .8rem; line-height: 1.6; }
.primary-open { width: 100%; min-height: 104px; padding: 20px 24px; display: grid; grid-template-columns: 48px 1fr 34px; align-items: center; gap: 18px; border: 1px solid #183e34; border-radius: 2px; color: #f8f8f3; background: var(--forest); text-align: left; box-shadow: 7px 7px 0 #d7d5cc; transition: transform .18s var(--ease), box-shadow .18s var(--ease), background .18s ease; }
.primary-open:hover:not(:disabled) { transform: translate(2px, 2px); box-shadow: 4px 4px 0 #d7d5cc; background: #204b40; }
.primary-open svg { width: 35px; height: 35px; }
.button-copy strong { display: block; font-size: 1rem; letter-spacing: .01em; }
.button-copy small { display: block; margin-top: 6px; color: #c5d7cf; font-size: .71rem; font-weight: 400; }
.button-arrow { color: #e0ad5c; font-size: 1.35rem; transition: transform .18s var(--ease); }
.primary-open:hover .button-arrow { transform: translateX(5px); }
.zero-write { margin: 13px 0 28px; color: #6a736e; font-size: .7rem; line-height: 1.55; }
.manual-panel { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.manual-panel summary { cursor: pointer; padding: 15px 4px; color: #33443d; font-size: .76rem; font-weight: 700; list-style: none; }
.manual-panel summary::-webkit-details-marker { display: none; }
.manual-panel summary::after { content: "+"; float: right; color: #936a2b; font-family: Consolas, monospace; }
.manual-panel[open] summary::after { content: "−"; }
.manual-body { padding: 0 4px 19px; }
.manual-panel[open] .manual-body { animation: detail-in .22s var(--ease) both; }
.manual-body > p { margin: 0 0 10px; color: var(--muted); font-size: .71rem; line-height: 1.55; }
.manual-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; align-items: end; }
.manual-open, .primary-action, .secondary, .danger, .change-project { min-height: 40px; border-radius: 2px; padding: .61rem .78rem; font-weight: 700; }
.manual-open { border: 1px solid var(--forest); color: var(--forest); background: transparent; font-size: .75rem; }
.manual-open:hover:not(:disabled), .secondary:hover:not(:disabled), .change-project:hover:not(:disabled) { background: #e9eee9; }

.setup { width: min(930px, 100%); margin: 32px auto 0; border: 1px solid var(--line); background: var(--paper); animation: view-in .4s var(--ease) both; }
.setup-header { padding: 25px 30px; display: grid; grid-template-columns: 54px 1fr; gap: 18px; border-bottom: 1px solid var(--line); }
.setup-header h1 { margin: 0; font-family: Georgia, serif; font-size: 2rem; font-weight: 400; }
.setup-header p { margin: 8px 0 0; color: var(--muted); font-size: .79rem; line-height: 1.6; }
.setup form { padding: 24px 102px 32px; }
.primary-action { border: 1px solid var(--forest); color: #fff; background: var(--forest); }
.primary-action:hover:not(:disabled) { background: #204b40; }
.setup .primary-action, #prepare-form > .primary-action { margin-top: 12px; }
.secondary { border: 1px solid #819089; color: var(--forest); background: transparent; }
.danger { border: 1px solid var(--danger); color: #fff; background: var(--danger); }

.room-shell { animation: view-in .4s var(--ease) both; }
.room-header { min-height: 102px; padding: 18px 0 20px; display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--line-dark); }
.room-title { display: grid; grid-template-columns: 54px 1fr; gap: 18px; }
.room-title h1 { margin: 0; font-family: Georgia, serif; font-size: 2rem; font-weight: 400; letter-spacing: -.02em; }
.room-title p { margin: 5px 0 0; color: var(--muted); font-size: .74rem; }
.change-project { border: 1px solid var(--line-dark); color: #34433c; background: transparent; font-size: .73rem; }
.grid { display: grid; grid-template-columns: minmax(260px, .9fr) minmax(390px, 1.35fr) minmax(260px, .9fr); gap: 0; border-left: 1px solid var(--line); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--paper); }
.panel { min-width: 0; padding: 24px 22px 30px; border-right: 1px solid var(--line); background: var(--paper); animation: panel-in .36s var(--ease) both; }
.panel:nth-child(2) { animation-delay: .06s; }
.panel:nth-child(3) { border-right: 0; animation-delay: .12s; }
.panel-kicker { margin: 0 0 8px; color: #8b672f; font-family: Consolas, monospace; font-size: .65rem; letter-spacing: .11em; text-transform: uppercase; }
.panel h2, .panel h3 { font-family: Georgia, serif; color: #23322c; font-weight: 500; }
.panel h2 { margin: 0; font-size: 1.32rem; }
.panel h3 { margin: 1.3rem 0 .42rem; padding-top: .72rem; border-top: 1px solid #ddddd6; font-size: .92rem; }
.panel p { line-height: 1.52; }
.muted { color: var(--muted); font-size: .76rem; line-height: 1.58; }
.status { font-family: Consolas, "SFMono-Regular", monospace; font-size: .7rem; line-height: 1.52; overflow-wrap: anywhere; white-space: pre-line; color: #59645e; }
.list { margin: .35rem 0 .9rem; padding-left: 1.05rem; }
.list li { margin: .26rem 0; font-size: .79rem; line-height: 1.45; }
.manifest { margin-top: 1rem; border-top: 1px solid var(--line); padding-top: 1rem; animation: detail-in .25s var(--ease) both; }
.manifest table { width: 100%; border-collapse: collapse; font-size: .7rem; }
.manifest th, .manifest td { text-align: left; padding: .42rem .3rem; border-bottom: 1px solid #ddddD6; vertical-align: top; }
.manifest th { color: #5b6660; font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: .85rem; }
.finding { border-left: 2px solid #5f8575; padding: .58rem .68rem; margin: .5rem 0; background: #edf1ed; font-size: .77rem; line-height: 1.5; animation: finding-in .25s var(--ease) both; }
.receipt { border-top: 1px solid #d9dad3; padding: .76rem 0; animation: detail-in .24s var(--ease) both; }
.receipt:first-of-type { border-top: 0; }
.receipt button { margin: .3rem .22rem 0 0; padding: .42rem .55rem; font-size: .69rem; }
.file-field { margin-top: .7rem; padding: .74rem; border: 1px dashed #a9aea8; background: #f0efe9; }
.file-field label { margin-top: 0; }
.file-control { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: center; margin: .55rem 0 .52rem; }
.native-file-input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.file-button { min-height: 38px; margin: 0; padding: .58rem .72rem; display: inline-flex; align-items: center; border: 1px solid #819089; border-radius: 2px; color: var(--forest); background: #fafaf7; cursor: pointer; font-size: .72rem; font-weight: 700; }
.file-button:hover { background: #e5ebe6; }
.native-file-input:focus-visible + .file-button { outline: 2px solid #d49a43; outline-offset: 3px; }
.file-name { min-width: 0; overflow: hidden; color: #66706a; font-size: .7rem; text-overflow: ellipsis; white-space: nowrap; }

@keyframes view-in { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
@keyframes panel-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes detail-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes finding-in { from { opacity: 0; transform: translateX(-5px); } to { opacity: 1; transform: translateX(0); } }
@keyframes draw-down { from { transform: scaleY(0); transform-origin: top; } to { transform: scaleY(1); transform-origin: top; } }
@keyframes marker-pulse { 0%, 100% { box-shadow: 0 0 0 4px #e5d7bc; } 50% { box-shadow: 0 0 0 7px rgb(229 215 188 / 45%); } }
@keyframes activity { 0% { transform: translateX(-110%); } 65%, 100% { transform: translateX(440%); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition-duration: .01ms !important; }
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
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">S</span><div class="brand-copy"><strong>Sestina</strong><span data-i18n="brand_subtitle">Research process debugger</span></div></div>
    <div class="topbar-tools">
      <span class="connection"><span class="connection-dot" aria-hidden="true"></span><span data-i18n="local_status">本机 / Local</span></span>
      <div id="language-controls" class="language-controls" hidden aria-label="Language"><button class="language-toggle" type="button" data-language="zh-CN" aria-label="中文">中文</button><span class="language-divider">/</span><button class="language-toggle" type="button" data-language="en" aria-label="English">EN</button></div>
    </div>
  </header>
  <div class="activity-line" aria-hidden="true"></div>
  <main>
    <div id="live" role="status" aria-live="polite"></div>

    <section id="language-setup" class="language-screen">
      <div class="language-context">
        <div><span class="setup-index">INITIAL SETUP / 00</span><h1>选择界面语言<br>Choose your language</h1><p>语言决定 Sestina 如何呈现研究工作台，但不会改变你的研究内容。<br>The language changes the interface, never your research.</p></div>
        <p class="language-principle"><strong>本机记忆 / Remembered locally</strong><br>只保存所选语言，不保存项目、研究文本或设备信息。你可以随时在右上角改变选择。<br>Only the language is stored. You can change it from the top-right control at any time.</p>
      </div>
      <div class="language-picker">
        <h2 id="language-title">选择界面语言 / Choose your language</h2>
        <p>请选择一种语言继续。Select one language to continue.</p>
        <button class="language-choice" type="button" data-language-choice="zh-CN" aria-label="中文"><span class="choice-code">ZH</span><span><strong>中文</strong><small>使用简体中文界面</small></span><span class="choice-arrow" aria-hidden="true">→</span></button>
        <button class="language-choice" type="button" data-language-choice="en" aria-label="English"><span class="choice-code">EN</span><span><strong>English</strong><small>Use the English interface</small></span><span class="choice-arrow" aria-hidden="true">→</span></button>
        <p class="language-storage-note"><span aria-hidden="true">□</span><span><b>Local App preference</b><br>No account, sync, telemetry, or Provider call.</span></p>
      </div>
    </section>

    <section id="project-launch" class="workspace" hidden>
      <header class="workspace-header">
        <div class="workspace-heading"><span class="section-number">01</span><div><h1 data-i18n="project_heading">打开研究项目</h1><p data-i18n="project_deck">选择一个本地研究文件夹。已有项目直接恢复，普通文件夹会在你的明确动作后完成本地初始化。</p></div></div>
        <div class="workspace-state"><b data-i18n="entry_state_title">PROJECT ENTRY</b><span data-i18n="entry_state_body">等待你选择研究工作区</span></div>
      </header>
      <div class="entry-grid">
        <aside class="workflow-rail">
          <p class="rail-label" data-i18n="workflow_label">Research workflow</p>
          <ol class="workflow-list">
            <li class="workflow-item active"><b data-i18n="step_project">选择项目</b><span data-i18n="step_project_body">明确一个本地研究文件夹</span></li>
            <li class="workflow-item"><b data-i18n="step_brief">建立 Brief</b><span data-i18n="step_brief_body">固定问题与当前最小任务</span></li>
            <li class="workflow-item"><b data-i18n="step_room">进入审议</b><span data-i18n="step_room_body">围绕决定、证据和纠偏工作</span></li>
          </ol>
          <div class="privacy-ledger" aria-label="Privacy boundaries"><div><span data-i18n="local_only">仅在本机</span></div><div><span data-i18n="no_scan">不扫描目录</span></div><div><span data-i18n="no_network">不自动联网</span></div></div>
        </aside>
        <div class="entry-main">
          <h2 data-i18n="open_title">选择项目目录</h2>
          <p data-i18n="open_body">使用 Windows 系统窗口完成选择。Sestina 只接收你确认的一个文件夹。</p>
          <button id="choose-folder" class="primary-open" type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.75 6.75a2 2 0 0 1 2-2h4l2 2h6.5a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V6.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 9.5h16" stroke="currentColor" stroke-width="1.5"/></svg>
            <span class="button-copy"><strong data-i18n="choose_folder">选择文件夹并打开</strong><small data-i18n="choose_folder_hint">打开 Windows 系统文件夹选择窗口</small></span><span class="button-arrow" aria-hidden="true">→</span>
          </button>
          <p class="zero-write" data-i18n="cancel_zero_write">取消不会写入任何内容；系统不会生成路径历史。</p>
          <details id="manual-mode" class="manual-panel">
            <summary><span data-i18n="manual_summary">手动输入绝对路径</span></summary>
            <div class="manual-body"><p data-i18n="manual_body">系统窗口不可用或你已复制路径时使用。两种模式执行相同规则。</p><form id="project-form" class="manual-actions"><div><label for="project-path" data-i18n="project_path_label">项目绝对路径</label><input id="project-path" name="projectPath" required autocomplete="off" spellcheck="false" data-i18n-placeholder="project_path_placeholder" placeholder="D:\research\project"></div><button id="manual-open" class="manual-open" type="submit" data-i18n="manual_open">按此路径打开或初始化</button></form></div>
          </details>
        </div>
      </div>
    </section>

    <section id="project-setup" class="setup" hidden>
      <header class="setup-header"><span class="section-number">02</span><div><h1 data-i18n="brief_heading">建立这项研究的工作主线</h1><p data-i18n="brief_deck">文件夹已就绪。研究问题和当前任务必须由你明确填写；Sestina 不会从目录或模型输出中替你编造。</p></div></header>
      <form id="brief-form">
        <label for="initial-question" data-i18n="question_label">研究问题</label><textarea id="initial-question" required maxlength="4096" data-i18n-placeholder="question_placeholder" placeholder="这项研究当前真正需要回答什么？"></textarea>
        <label for="initial-task" data-i18n="task_label">当前最小研究任务</label><textarea id="initial-task" required maxlength="4096" data-i18n-placeholder="task_placeholder" placeholder="接下来要完成的最小、可验证工作是什么？"></textarea>
        <button class="primary-action" type="submit" data-i18n="activate_brief">激活 Brief 并进入 Research Room</button>
      </form>
    </section>

    <section id="room" class="room-shell" hidden>
      <header class="room-header"><div class="room-title"><span class="section-number">03</span><div><h1 data-i18n="room_heading">围绕当前研究问题工作</h1><p id="project-title"></p></div></div><button id="change-project" class="change-project" type="button" data-i18n="change_project">切换研究项目</button></header>
      <div class="grid">
        <article class="panel state-panel"><p class="panel-kicker">01 / STATE</p><h2 data-i18n="state_heading">当前研究状态</h2>
          <h3>Research Brief</h3><p><strong data-i18n="question_prefix">问题：</strong><span id="question"></span></p><p><strong data-i18n="stage_prefix">阶段：</strong><span id="stage"></span></p><p><strong data-i18n="task_prefix">当前任务：</strong><span id="task"></span></p>
          <h3 data-i18n="fixed_heading">必须保留的决定</h3><ul id="fixed" class="list"></ul><h3 data-i18n="decisions_heading">已接受决定</h3><ul id="decisions" class="list"></ul><h3 data-i18n="issues_heading">开放问题</h3><ul id="issues" class="list"></ul><h3 data-i18n="episode_heading">当前 Episode</h3><p id="episode" class="status"></p>
        </article>
        <article class="panel review-panel"><p class="panel-kicker">02 / REVIEW</p><h2 data-i18n="review_heading">审议一个建议</h2><p class="muted" data-i18n="review_deck">一次只审议一项建议。先核对发送清单，再决定是否让 Provider 分析。</p>
          <form id="prepare-form"><label for="suggestion" data-i18n="suggestion_label">单个建议</label><textarea id="suggestion" required maxlength="16384" data-i18n-placeholder="suggestion_placeholder" placeholder="粘贴本轮需要审议的一项建议"></textarea>
            <div class="file-field"><label for="suggestion-file" data-i18n="file_label">或读取一个本地文本文件</label><div class="file-control"><input id="suggestion-file" class="native-file-input" type="file" accept=".txt,.md,text/plain,text/markdown"><label class="file-button" for="suggestion-file" data-i18n="choose_text_file">选择文本文件</label><span id="suggestion-file-name" class="file-name" data-i18n="no_file_selected">未选择文件</span></div><span class="muted" data-i18n="file_hint">仅由浏览器读取你明确选中的一个文件，不扫描目录。</span></div>
            <label for="evidence-class" data-i18n="evidence_label">证据类别</label><select id="evidence-class"><option value="owner_scenario">owner_scenario</option><option value="synthetic_fixture">synthetic_fixture</option><option value="synthetic_adversarial_fixture">synthetic_adversarial_fixture</option></select>
            <button class="primary-action" type="submit" data-i18n="prepare_manifest">先生成 Context Manifest</button>
          </form>
          <section id="manifest" class="manifest" hidden><h3 data-i18n="manifest_heading">Context Manifest（发送前）</h3><p id="manifest-summary" class="status"></p><table><thead><tr><th data-i18n="field_col">字段</th><th data-i18n="source_col">来源</th><th data-i18n="sensitivity_col">敏感性</th></tr></thead><tbody id="manifest-fields"></tbody></table><div class="actions"><button id="analyze" class="primary-action" type="button" data-i18n="analyze_button">我已核对，开始分析</button><button id="cancel-review" class="secondary" type="button" data-i18n="cancel_button">取消</button></div></section>
          <section id="analysis" class="manifest" hidden><h3 data-i18n="analysis_heading">分析结果</h3><p id="provider-status" class="status"></p><div id="findings"></div><p><strong data-i18n="delta_prefix">真正增加：</strong><span id="delta"></span></p><p><strong data-i18n="alternatives_prefix">替代解释：</strong><span id="alternatives"></span></p><p><strong data-i18n="unproven_prefix">未证明：</strong><span id="unproven"></span></p><p><strong data-i18n="correction_prefix">最小纠正：</strong><span id="correction"></span></p>
            <label for="reason" data-i18n="reason_label">你的处置理由</label><textarea id="reason" required maxlength="4096"></textarea><label for="modified" id="modified-label" hidden data-i18n="modified_label">修改后建议</label><textarea id="modified" maxlength="16384" hidden></textarea><label for="redirect" id="redirect-label" hidden data-i18n="redirect_label">新的正式研究问题</label><textarea id="redirect" maxlength="4096" hidden></textarea>
            <div class="actions" id="dispositions"><button class="primary-action" type="button" data-disposition="accepted" data-i18n="accept_button">接受</button><button type="button" class="secondary" data-disposition="rejected" data-i18n="reject_button">拒绝</button><button class="primary-action" type="button" data-disposition="modified_accepted" data-i18n="modify_accept_button">修改后接受</button><button type="button" class="secondary" data-disposition="deferred" data-i18n="defer_button">暂缓</button><button type="button" class="danger" data-disposition="direction_changed" data-i18n="redirect_button">正式改向</button></div>
          </section>
        </article>
        <article class="panel receipts-panel"><p class="panel-kicker">03 / RECEIPTS</p><h2 data-i18n="receipts_heading">Episode 凭证</h2><p class="muted" data-i18n="receipts_deck">只保存结构化理由、状态绑定与用户处置，不保存隐藏思维链或 Provider 原始响应。</p><div id="receipts"></div></article>
      </div>
    </section>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>`;

export const RESEARCH_ROOM_JS = String.raw`
const $ = (id) => document.getElementById(id);
let token = "", projectId = "", prepared, analyzed, currentLanguage = "zh-CN", lastState;

const COPY = {
  "zh-CN": {
    brand_subtitle: "Research process debugger", local_status: "本机服务", project_heading: "打开研究项目", project_deck: "选择一个本地研究文件夹。已有项目直接恢复，普通文件夹会在你的明确动作后完成本地初始化。", entry_state_title: "PROJECT ENTRY", entry_state_body: "等待你选择研究工作区", workflow_label: "Research workflow", step_project: "选择项目", step_project_body: "明确一个本地研究文件夹", step_brief: "建立 Brief", step_brief_body: "固定问题与当前最小任务", step_room: "进入审议", step_room_body: "围绕决定、证据和纠偏工作", local_only: "仅在本机", no_scan: "不扫描目录", no_network: "不自动联网", open_title: "选择项目目录", open_body: "使用 Windows 系统窗口完成选择。Sestina 只接收你确认的一个文件夹。", choose_folder: "选择文件夹并打开", choose_folder_hint: "打开 Windows 系统文件夹选择窗口", cancel_zero_write: "取消不会写入任何内容；系统不会生成路径历史。", manual_summary: "手动输入绝对路径", manual_body: "系统窗口不可用或你已复制路径时使用。两种模式执行相同规则。", project_path_label: "项目绝对路径", project_path_placeholder: "D:\\research\\project", manual_open: "按此路径打开或初始化", brief_heading: "建立这项研究的工作主线", brief_deck: "文件夹已就绪。研究问题和当前任务必须由你明确填写；Sestina 不会从目录或模型输出中替你编造。", question_label: "研究问题", question_placeholder: "这项研究当前真正需要回答什么？", task_label: "当前最小研究任务", task_placeholder: "接下来要完成的最小、可验证工作是什么？", activate_brief: "激活 Brief 并进入 Research Room", room_heading: "围绕当前研究问题工作", change_project: "切换研究项目", state_heading: "当前研究状态", question_prefix: "问题：", stage_prefix: "阶段：", task_prefix: "当前任务：", fixed_heading: "必须保留的决定", decisions_heading: "已接受决定", issues_heading: "开放问题", episode_heading: "当前 Episode", review_heading: "审议一个建议", review_deck: "一次只审议一项建议。先核对发送清单，再决定是否让 Provider 分析。", suggestion_label: "单个建议", suggestion_placeholder: "粘贴本轮需要审议的一项建议", file_label: "或读取一个本地文本文件", choose_text_file: "选择文本文件", no_file_selected: "未选择文件", file_hint: "仅由浏览器读取你明确选中的一个文件，不扫描目录。", evidence_label: "证据类别", prepare_manifest: "先生成 Context Manifest", manifest_heading: "Context Manifest（发送前）", field_col: "字段", source_col: "来源", sensitivity_col: "敏感性", analyze_button: "我已核对，开始分析", cancel_button: "取消", analysis_heading: "分析结果", delta_prefix: "真正增加：", alternatives_prefix: "替代解释：", unproven_prefix: "未证明：", correction_prefix: "最小纠正：", reason_label: "你的处置理由", modified_label: "修改后建议", redirect_label: "新的正式研究问题", accept_button: "接受", reject_button: "拒绝", modify_accept_button: "修改后接受", defer_button: "暂缓", redirect_button: "正式改向", receipts_heading: "Episode 凭证", receipts_deck: "只保存结构化理由、状态绑定与用户处置，不保存隐藏思维链或 Provider 原始响应。", none: "无", no_episode: "无当前 Episode", no_receipts: "还没有凭证。", download_receipt: "下载凭证", rollback: "回滚", service_ready: "本地服务已就绪；请选择一个研究文件夹。", picker_unavailable: "当前环境不能打开系统文件夹窗口，请使用绝对路径方式。", picker_working: "正在等待你在系统窗口中选择文件夹……", picker_cancelled: "你已取消选择；没有写入或初始化任何内容。", picker_fallback: "你仍可使用下方绝对路径方式。", manual_working: "正在打开或初始化指定项目……", initialized: "已在所选文件夹完成本地初始化。请建立初始 Research Brief。", brief_required: "项目已打开，但还需要建立初始 Research Brief。", opened: "研究项目已在本机打开；路径不会写入凭证或日志。", brief_working: "正在建立 Research Brief……", brief_active: "Research Brief 已由你激活；现在可以围绕这项研究继续工作。", project_switch: "请选择另一个研究项目；当前项目状态仍保留在原文件夹中。", file_large: "文件超过 16 KiB 限制。", file_loaded: "只读取了你明确选中的一个文件。", manifest_ready: "Context Manifest 已生成。核对后才会调用 Provider。", manifest_provider: "Provider", manifest_network: "网络需求", manifest_unsent: "当前未发送", external_false: "外部证据计数: false", review_cancelled: "本次审议已在发送前取消。", analysis_ready: "分析已返回。模型不能替你作出处置。", modified_required: "请先填写修改后建议，再次点击“修改后接受”。", redirect_required: "请先填写新的正式研究问题，再次点击“正式改向”。", reason_required: "请填写你的处置理由。", committed: "你的处置已提交，并生成版本化 Episode 凭证。", downloaded: "凭证下载已由你显式启动。", download_failed: "下载失败", rollback_prompt: "请输入回滚理由。此动作会创建新的版本化状态。", rollback_default: "撤销本次用户处置。", rolled_back: "已回滚，并保留可审计凭证。", language_saved: "界面语言已保存为中文。", request_failed: "本地请求未完成。", local_unavailable: "本地服务不可用。"
  },
  en: {
    brand_subtitle: "Research process debugger", local_status: "Local service", project_heading: "Open a research project", project_deck: "Choose one local research folder. Existing projects resume directly; a plain folder is initialized only after your explicit action.", entry_state_title: "PROJECT ENTRY", entry_state_body: "Waiting for a research workspace", workflow_label: "Research workflow", step_project: "Select project", step_project_body: "Choose one explicit local folder", step_brief: "Set the Brief", step_brief_body: "Fix the question and smallest current task", step_room: "Enter deliberation", step_room_body: "Work with decisions, evidence, and corrections", local_only: "Local only", no_scan: "No directory scan", no_network: "No automatic network", open_title: "Choose the project directory", open_body: "Use the Windows system dialog. Sestina receives only the single folder you confirm.", choose_folder: "Select a folder and open", choose_folder_hint: "Open the Windows system folder dialog", cancel_zero_write: "Cancelling writes nothing and creates no path history.", manual_summary: "Enter an absolute path manually", manual_body: "Use this when the system dialog is unavailable or you already copied a path. Both modes follow the same rules.", project_path_label: "Project absolute path", project_path_placeholder: "D:\\research\\project", manual_open: "Open or initialize this path", brief_heading: "Set the research working line", brief_deck: "The folder is ready. You must state the research question and current task; Sestina will not invent them from files or model output.", question_label: "Research question", question_placeholder: "What does this research genuinely need to answer now?", task_label: "Current smallest research task", task_placeholder: "What is the smallest verifiable piece of work to do next?", activate_brief: "Activate Brief and enter Research Room", room_heading: "Work on the current research question", change_project: "Change research project", state_heading: "Current research state", question_prefix: "Question: ", stage_prefix: "Stage: ", task_prefix: "Current task: ", fixed_heading: "Decisions that must survive", decisions_heading: "Accepted decisions", issues_heading: "Open issues", episode_heading: "Current Episode", review_heading: "Review one suggestion", review_deck: "Review one suggestion at a time. Inspect the send manifest before deciding whether a Provider should analyze it.", suggestion_label: "Single suggestion", suggestion_placeholder: "Paste the one suggestion to review in this round", file_label: "Or read one local text file", choose_text_file: "Choose text file", no_file_selected: "No file selected", file_hint: "The browser reads only the file you explicitly choose. It does not scan a directory.", evidence_label: "Evidence class", prepare_manifest: "Generate Context Manifest first", manifest_heading: "Context Manifest (before sending)", field_col: "Field", source_col: "Source", sensitivity_col: "Sensitivity", analyze_button: "I reviewed it; start analysis", cancel_button: "Cancel", analysis_heading: "Analysis result", delta_prefix: "Genuine addition: ", alternatives_prefix: "Alternative explanations: ", unproven_prefix: "Unproven: ", correction_prefix: "Minimal correction: ", reason_label: "Your disposition reason", modified_label: "Modified suggestion", redirect_label: "New formal research question", accept_button: "Accept", reject_button: "Reject", modify_accept_button: "Accept after modification", defer_button: "Defer", redirect_button: "Formally redirect", receipts_heading: "Episode receipts", receipts_deck: "Stores structured reasons, state bindings, and owner dispositions—not hidden reasoning or raw Provider responses.", none: "None", no_episode: "No current Episode", no_receipts: "No receipts yet.", download_receipt: "Download receipt", rollback: "Roll back", service_ready: "Local service is ready; choose a research folder.", picker_unavailable: "The system folder dialog is unavailable. Use manual absolute-path entry.", picker_working: "Waiting for you to choose a folder in the system dialog…", picker_cancelled: "Selection cancelled; nothing was written or initialized.", picker_fallback: "You can still use manual absolute-path entry below.", manual_working: "Opening or initializing the specified project…", initialized: "Local initialization is complete. Set the initial Research Brief.", brief_required: "The project is open but still needs an initial Research Brief.", opened: "The research project is open locally; its path is not written to receipts or logs.", brief_working: "Setting the Research Brief…", brief_active: "You activated the Research Brief. Continue with this research in the Room.", project_switch: "Choose another research project. The current project remains in its original folder.", file_large: "The file exceeds the 16 KiB limit.", file_loaded: "Only the file you explicitly selected was read.", manifest_ready: "The Context Manifest is ready. No Provider is called until you confirm.", manifest_provider: "Provider", manifest_network: "Network required", manifest_unsent: "not sent", external_false: "counts as external evidence: false", review_cancelled: "The review was cancelled before sending.", analysis_ready: "Analysis returned. The model cannot choose a disposition for you.", modified_required: "Enter the modified suggestion, then click Accept after modification again.", redirect_required: "Enter the new formal research question, then click Formally redirect again.", reason_required: "Enter your disposition reason.", committed: "Your disposition was committed and a versioned Episode receipt was created.", downloaded: "You explicitly started the receipt download.", download_failed: "Download failed", rollback_prompt: "Enter the rollback reason. This creates a new versioned state.", rollback_default: "Undo this owner disposition.", rolled_back: "Rolled back with an auditable receipt retained.", language_saved: "Interface language saved as English.", request_failed: "The local request could not be completed.", local_unavailable: "The local service is unavailable."
  }
};

const ERROR_COPY = {
  "zh-CN": { invalid_language: "请选择中文或 English。", language_preference_required: "继续前请先选择界面语言。", language_preference_unavailable: "本机语言偏好不可用。", language_preference_write_failed: "无法在本机保存语言选择，请检查本机应用数据权限。", directory_picker_unavailable: "系统文件夹窗口不可用。", directory_picker_failed: "无法打开系统文件夹窗口。", directory_picker_busy: "已有一个系统文件夹窗口正在等待选择。", project_not_found: "所选文件夹不可用。", initialization_confirmation_required: "该文件夹需要你的明确初始化动作。", state_conflict: "项目状态存在冲突，已保留原有内容。", invalid_input: "输入内容无效。", explicit_action_required: "此操作需要当前本地会话授权。", request_too_large: "请求超过本地安全限制。" },
  en: { invalid_language: "Choose Chinese or English.", language_preference_required: "Choose the interface language before continuing.", language_preference_unavailable: "The local language preference is unavailable.", language_preference_write_failed: "The language choice could not be saved locally. Check local App-data permissions.", directory_picker_unavailable: "The system folder dialog is unavailable.", directory_picker_failed: "The system folder dialog could not be opened.", directory_picker_busy: "A system folder dialog is already waiting for a choice.", project_not_found: "The selected folder is unavailable.", initialization_confirmation_required: "This folder requires your explicit initialization action.", state_conflict: "The project state conflicts with Sestina and the original content was preserved.", invalid_input: "The input is invalid.", explicit_action_required: "This action requires the active local session.", request_too_large: "The request exceeds the local safety limit." }
};

const t = (key) => COPY[currentLanguage][key] || key;
function applyLanguage(language) {
  currentLanguage = language; document.documentElement.lang = language; document.title = language === "en" ? "Sestina Research Room" : "Sestina 研究室";
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) element.placeholder = t(element.dataset.i18nPlaceholder);
  for (const button of document.querySelectorAll("[data-language]")) button.setAttribute("aria-pressed", String(button.dataset.language === language));
  updateFileName();
  if (lastState) showState(lastState);
}
function updateFileName() { const file = $("suggestion-file").files[0]; $("suggestion-file-name").textContent = file ? file.name : t("no_file_selected"); }
const live = (message, tone = "success") => { $("live").textContent = message; $("live").dataset.tone = tone; };
const escapeText = (value) => document.createTextNode(String(value));
async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.mutation ? { "x-sestina-session": token } : {}) };
  const response = await fetch(path, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const value = await response.json();
  if (!response.ok || value.ok !== true) { const code = value.error?.code || "request_failed"; const fallback = currentLanguage === "en" ? value.error?.message : undefined; const error = new Error(ERROR_COPY[currentLanguage][code] || fallback || t("request_failed")); error.code = code; throw error; }
  return value.value;
}
async function whileBusy(button, message, action) {
  button.disabled = true; button.setAttribute("aria-busy", "true"); document.body.dataset.busy = "true"; live(message, "working");
  try { return await action(); } finally { button.disabled = false; button.removeAttribute("aria-busy"); document.body.dataset.busy = "false"; }
}
function list(id, values, render) { const root = $(id); root.replaceChildren(); for (const value of values) { const li = document.createElement("li"); li.append(escapeText(render(value))); root.append(li); } if (!values.length) { const li = document.createElement("li"); li.append(escapeText(t("none"))); root.append(li); } }
function showState(state) {
  lastState = state; projectId = state.project.id; $("room").hidden = false; $("project-title").textContent = state.project.title;
  $("question").textContent = state.brief.projectQuestion; $("stage").textContent = state.brief.currentStage; $("task").textContent = state.brief.currentTask;
  list("fixed", state.brief.fixedDecisions, x => x.statement); list("decisions", state.decisions, x => x.statement + " [" + x.status + "]"); list("issues", state.issues, x => x.summary + " [" + x.status + "]");
  $("episode").textContent = state.currentEpisode ? state.currentEpisode.id + " · " + state.currentEpisode.status : t("no_episode"); showReceipts(state.receipts);
}
function showReceipts(receipts) {
  const root = $("receipts"); root.replaceChildren(); if (!receipts.length) { root.textContent = t("no_receipts"); return; }
  for (const receipt of receipts) { const item = document.createElement("section"); item.className = "receipt"; const title = document.createElement("strong"); title.textContent = receipt.disposition.kind + " · " + receipt.status; item.append(title); const info = document.createElement("p"); info.className = "status"; info.textContent = receipt.id + "\n" + receipt.receiptHash; item.append(info); const download = document.createElement("button"); download.type = "button"; download.className = "secondary"; download.textContent = t("download_receipt"); download.onclick = () => downloadReceipt(receipt.id); item.append(download); if (receipt.rollback.available) { const rollback = document.createElement("button"); rollback.type = "button"; rollback.className = "danger"; rollback.textContent = t("rollback"); rollback.onclick = () => rollbackReceipt(receipt); item.append(rollback); } root.append(item); }
}
async function refresh() { showState(await api("/api/state")); }
async function presentOpened(opened) { projectId = opened.project.id; $("project-form").reset(); $("project-launch").hidden = true; $("room").hidden = true; $("project-setup").hidden = !opened.setupRequired; if (opened.setupRequired) live(opened.initialized ? t("initialized") : t("brief_required"), "success"); else { await refresh(); live(t("opened"), "success"); } }
async function saveLanguage(language, button, firstRun) {
  const previous = currentLanguage;
  try { await whileBusy(button, firstRun ? "Saving locally / 正在本机保存……" : t("language_saved"), () => api("/api/preferences/language", { method: "POST", mutation: true, body: { language } })); applyLanguage(language); $("language-setup").hidden = true; $("language-controls").hidden = false; if ($("project-setup").hidden && $("room").hidden) $("project-launch").hidden = false; live(t("service_ready"), "success"); }
  catch (error) { applyLanguage(previous); live(firstRun ? "无法保存语言选择 / The language choice could not be saved locally." : error.message, "error"); }
}
async function downloadReceipt(id) { try { const response = await fetch("/api/receipts/" + encodeURIComponent(id) + "/download", { headers: { "x-sestina-session": token } }); if (!response.ok) throw new Error(t("download_failed")); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = id + ".json"; link.click(); URL.revokeObjectURL(url); live(t("downloaded"), "success"); } catch (error) { live(error.message, "error"); } }
async function rollbackReceipt(receipt) { const reason = window.prompt(t("rollback_prompt"), t("rollback_default")); if (!reason) return; try { await api("/api/receipts/" + encodeURIComponent(receipt.id) + "/rollback", { method: "POST", mutation: true, body: { expectedVersion: receipt.version, reason } }); await refresh(); live(t("rolled_back"), "success"); } catch (error) { live(error.message, "error"); } }

for (const button of document.querySelectorAll("[data-language-choice]")) button.addEventListener("click", () => { void saveLanguage(button.dataset.languageChoice, button, true); });
for (const button of document.querySelectorAll("[data-language]")) button.addEventListener("click", () => { if (button.dataset.language !== currentLanguage) void saveLanguage(button.dataset.language, button, false); });
$("choose-folder").addEventListener("click", async () => { try { const opened = await whileBusy($("choose-folder"), t("picker_working"), () => api("/api/project/select-directory", { method: "POST", mutation: true, body: {} })); if (!opened.selected) { live(t("picker_cancelled"), "success"); return; } await presentOpened(opened); } catch (error) { $("manual-mode").open = true; live(error.message + " " + t("picker_fallback"), "error"); } });
$("project-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const opened = await whileBusy($("manual-open"), t("manual_working"), () => api("/api/project/open", { method: "POST", mutation: true, body: { projectPath: $("project-path").value, initializeIfNeeded: true } })); await presentOpened(opened); } catch (error) { live(error.message, "error"); } });
$("brief-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const state = await whileBusy(event.submitter, t("brief_working"), () => api("/api/project/brief", { method: "POST", mutation: true, body: { projectQuestion: $("initial-question").value, currentTask: $("initial-task").value } })); $("project-setup").hidden = true; showState(state); live(t("brief_active"), "success"); } catch (error) { live(error.message, "error"); } });
$("change-project").addEventListener("click", () => { $("room").hidden = true; $("project-setup").hidden = true; $("project-launch").hidden = false; live(t("project_switch"), "success"); });
$("suggestion-file").addEventListener("change", async () => { updateFileName(); const file = $("suggestion-file").files[0]; if (!file) return; if (file.size > 16384) return live(t("file_large"), "error"); $("suggestion").value = await file.text(); live(t("file_loaded"), "success"); });
$("prepare-form").addEventListener("submit", async (event) => { event.preventDefault(); try { prepared = await api("/api/reviews/prepare", { method: "POST", mutation: true, body: { suggestion: $("suggestion").value, evidenceClass: $("evidence-class").value } }); analyzed = undefined; $("analysis").hidden = true; $("manifest").hidden = false; const m = prepared.manifest; $("manifest-summary").textContent = t("manifest_provider") + ": " + m.providerId + " · " + t("manifest_network") + ": " + m.networkRequired + " · " + t("manifest_unsent") + " · " + t("external_false"); const body = $("manifest-fields"); body.replaceChildren(); for (const field of m.fields) { const row = document.createElement("tr"); for (const value of [field.category, field.source, field.sensitivity]) { const td = document.createElement("td"); td.textContent = value; row.append(td); } body.append(row); } live(t("manifest_ready"), "success"); } catch (error) { live(error.message, "error"); } });
$("cancel-review").onclick = () => { prepared = undefined; analyzed = undefined; $("manifest").hidden = true; $("analysis").hidden = true; live(t("review_cancelled"), "success"); };
$("analyze").onclick = async () => { if (!prepared) return; try { analyzed = await api("/api/reviews/analyze", { method: "POST", mutation: true, body: { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash } }); $("analysis").hidden = false; $("provider-status").textContent = analyzed.providerStatus + (analyzed.ledgerOnlyReason ? " · " + analyzed.ledgerOnlyReason : ""); const findings = $("findings"); findings.replaceChildren(); for (const finding of analyzed.analysis.findings) { const div = document.createElement("div"); div.className = "finding"; div.textContent = finding.kind + " — " + finding.summary; findings.append(div); } $("delta").textContent = analyzed.analysis.argumentDelta.genuineAdditions.join("；") || analyzed.analysis.argumentDelta.summary; $("alternatives").textContent = analyzed.analysis.alternativeExplanations.join("；"); $("unproven").textContent = analyzed.analysis.unproven.join("；"); $("correction").textContent = analyzed.analysis.minimalCorrection; for (const button of $("dispositions").querySelectorAll("button")) button.disabled = analyzed.providerStatus === "ledger_only" && !["rejected", "deferred"].includes(button.dataset.disposition); live(t("analysis_ready"), "success"); } catch (error) { live(error.message, "error"); } };
for (const button of $("dispositions").querySelectorAll("button")) button.addEventListener("click", async () => { if (!analyzed) return; const disposition = button.dataset.disposition; const modifiedNeeded = disposition === "modified_accepted"; const redirectNeeded = disposition === "direction_changed"; $("modified").hidden = $("modified-label").hidden = !modifiedNeeded; $("redirect").hidden = $("redirect-label").hidden = !redirectNeeded; if (modifiedNeeded && !$("modified").value.trim()) return live(t("modified_required"), "error"); if (redirectNeeded && !$("redirect").value.trim()) return live(t("redirect_required"), "error"); if (!$("reason").value.trim()) return live(t("reason_required"), "error"); try { await api("/api/reviews/commit", { method: "POST", mutation: true, body: { projectId, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition, reason: $("reason").value, ...(modifiedNeeded ? { modifiedProposal: $("modified").value } : {}), ...(redirectNeeded ? { redirectQuestion: $("redirect").value } : {}) } }); prepared = undefined; analyzed = undefined; $("manifest").hidden = true; $("analysis").hidden = true; $("prepare-form").reset(); updateFileName(); $("reason").value = ""; $("modified").value = ""; $("redirect").value = ""; await refresh(); live(t("committed"), "success"); } catch (error) { live(error.message, "error"); } });

(async () => { try { const status = await api("/api/status"); token = status.sessionToken; if (status.languagePreference === null) { $("language-setup").hidden = false; $("project-launch").hidden = true; $("language-controls").hidden = true; $("live").textContent = ""; return; } applyLanguage(status.languagePreference); $("language-setup").hidden = true; $("language-controls").hidden = false; $("project-launch").hidden = false; if (!status.directoryPickerAvailable) { $("choose-folder").disabled = true; $("manual-mode").open = true; live(t("picker_unavailable"), "error"); } else live(t("service_ready"), "success"); } catch { live("本地服务不可用 / The local service is unavailable.", "error"); for (const button of document.querySelectorAll("[data-language-choice]")) button.disabled = true; } })();
`;
