import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { migrateKernelProject, openSestina } from "../../../packages/core/src/index.js";
import { join } from "node:path";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { productionUiProject } from "../ui-factory.js";

for (const en of [true, false]) test(`G7 built application: correction, uncertain recovery and revocable connections (${en ? "en" : "zh"})`, async ({ page }, info) => {
  const fixture = await productionUiProject();
  await migrateKernelProject({ projectRoot: fixture.root });
  const provider = {
    identity: { id:"synthetic",model:"fixture",family:"openai_compatible",locality:"local" as const,origin:"http://127.0.0.1:1",configGeneration:1,serializerVersion:"1.0.0" },
    maxOutputTokens:1024, calls:[] as string[], send:async (_body:string,_signal:AbortSignal)=>"",
  };
  let fail = false;
  provider.send = async (body, signal) => {
    if (fail) { provider.calls.push(body); throw new Error("Synthetic disconnect after possible send"); }
    provider.calls.push(body);
    const context=JSON.parse(JSON.parse(body).messages[1].content);
    return JSON.stringify({ schemaVersion:"2.0.0",requestBinding:context.requestBinding,publicSummary:"Synthetic conditional claim remains unproven.",quotedSpans:[], assessment: {
      findings: [{ kind:"argument_leap", severity:"warning", publicRationale:"A conditional statement is not causal proof", minimalCorrection:"Keep the condition", unknowns:["Whether the condition holds"], sourceSpans:[], authorityClass:"model_proposed_assessment" }],
      argumentDelta:{status:"unknown",summary:"No substantive result established",sourceSpans:[]},
    } });
  };
  const app = createResearchRoomServer({ kernelProvider: async () => provider, languagePreferenceStore: { readLanguage:async()=>en?"en":"zh-CN",writeLanguage:async()=>{} } });
  const server = await app.start();
  const label=(english:string,chinese:string)=>en?english:chinese;
  const button=(english:string,chinese:string)=>page.getByRole("button",{name:label(english,chinese),exact:true});
  const textbox=(english:string,chinese:string)=>page.getByRole("textbox",{name:label(english,chinese),exact:true});
  const assessment = async () => {
    await button("View send content","查看发送内容").click();
    await page.getByRole("checkbox",{name:label("I have checked this exact content.","我已核对以上准确发送内容。"),exact:true}).check();
    await button("Confirm content","确认内容").click();
    await button("Prepare this request","准备本次请求").click();
    await button("Send this request","发送本次请求").click();
  };
  try {
    await page.addInitScript(()=>localStorage.setItem("sestina.app.appearance.v1",JSON.stringify({version:1,theme:"high_contrast",reducedMotion:"on",reducedTransparency:true})));
    await page.goto(`${server.origin}/project/kernel`);
    await textbox("Project folder","项目文件夹").fill(fixture.root);
    await button("Open project","打开项目").click();
    await button("Saved reviews","已保存审议").click();
    await textbox("New suggestion","新的建议").fill("Synthetic conditional statement requires qualification.");
    await button("Save draft","保存草稿").click();
    await assessment();
    await expect(page.getByRole("status").filter({hasText:label("Assessment saved","评估已保存")})).toBeVisible();
    await page.getByText(label("Dispute an assessment","纠正或质疑评估"),{exact:true}).click();
    await page.getByRole("combobox",{name:label("Original assessment","原评估"),exact:true}).selectOption({index:1});
    await page.getByRole("combobox",{name:label("Scope of correction","纠正范围"),exact:true}).selectOption("0");
    await textbox("Your reason","你的理由").fill("The original condition must remain explicit.");
    await button("Save correction draft","保存纠正草稿").click();
    await expect(page.getByRole("heading",{name:label("Correction record","纠错记录"),exact:true})).toBeVisible();
    await page.reload();
    expect(provider.calls).toHaveLength(1);
    await button("View send content","查看发送内容").click();
    await expect(page.getByRole("alert")).toContainText(label("No assessment provider","尚未配置评估服务"));
    await button("Continue without assessment","跳过评估，继续处理").click();
    await textbox("Reason","理由").fill("Record the dispute without altering research objects.");
    await button("View changes","查看修改").click();
    await page.getByRole("checkbox",{name:label("I confirm the changes shown above.","我确认以上具体修改。"),exact:true}).check();
    await button("Confirm and save","确认并保存").click();
    await expect(page.getByRole("status").filter({hasText:label("Closed by a saved user effect","已通过保存的用户操作结案")})).toBeVisible();
    await page.getByRole("heading",{name:label("Correction record","纠错记录"),exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath("correction-closed.png")});
    await button("Draft connections","草稿连接").click();
    await button("Enable temporary connection","启用临时连接").click();
    await expect(page.getByText(label("Draft access token","草稿访问令牌"),{exact:true})).toBeVisible();
    await button("Revoke connection","撤销连接").click();
    await expect(page.getByText(label("Draft access token","草稿访问令牌"),{exact:true})).toHaveCount(0);
    fail = true;
    await button("Saved reviews","已保存审议").click();
    await textbox("New suggestion","新的建议").fill("Synthetic send outcome is uncertain.");
    await button("Save draft","保存草稿").click();
    await assessment();
    await expect(page.getByRole("status").filter({hasText:label("Send outcome uncertain","外发结果不确定")})).toBeVisible();
    await page.reload();
    expect(provider.calls).toHaveLength(2);
    await expect(page.getByRole("status").filter({hasText:label("Send outcome uncertain","外发结果不确定")})).toBeVisible();
    await page.screenshot({path:info.outputPath("uncertain-recovered.png")});
    await button("Continue without assessment","跳过评估，继续处理").click();
    expect(provider.calls).toHaveLength(2);
  } finally { await server.close(); await fixture.cleanup(); }
});

test("G7 built drawer: long lists, 200% text, interruptible motion and explicit backup retention",async({page},info)=>{
  const fixture=await productionUiProject();await migrateKernelProject({projectRoot:fixture.root});
  const app=createResearchRoomServer({languagePreferenceStore:{readLanguage:async()=>"en",writeLanguage:async()=>{}}}),server=await app.start();
  const post=async(path:string,body:unknown)=>{const response=await fetch(server.origin+path,{method:"POST",headers:{"Content-Type":"application/json","x-sestina-session":app.application.sessionToken},body:JSON.stringify(body)});const result=await response.json();expect(result.ok).toBe(true);return result.value;};
  try {
    await post("/api/kernel/open",{projectPath:fixture.root});
    for(let i=0;i<22;i++) await post("/api/kernel/reviews",{action:"govern_memory",projectId:fixture.projectId,commandId:`synthetic-ui-memory-${i}`,expectedRevision:i+1,input:{action:"create",kind:"working_hint",content:{text:i===0?"Long synthetic context. "+"Retain the observation boundary; do not claim causation. ".repeat(90):`Synthetic context item ${i}`},retention:{policy:"until_unpinned"},sensitivity:"project_private",outboundPolicy:"never_send",publicReason:"Synthetic visual state"}});
    await page.setViewportSize({width:1440,height:900});
    await page.emulateMedia({reducedMotion:"no-preference"});
    await page.addInitScript(()=>localStorage.setItem("sestina.app.appearance.v1",JSON.stringify({version:1,theme:"dark",reducedMotion:"off",reducedTransparency:true})));
    await page.goto(server.origin+"/project/kernel");
    const open=page.getByRole("button",{name:"Manage project context",exact:true});
    await open.click();
    const drawer=page.getByRole("dialog",{name:"Project context",exact:true});
    await expect(drawer.locator("article")).toHaveCount(20);
    await drawer.getByRole("button",{name:"Next page",exact:true}).click();
    await expect(drawer.locator("article")).toHaveCount(2);
    await drawer.getByRole("button",{name:"Previous page",exact:true}).click();
    await drawer.getByRole("textbox",{name:"Search context",exact:true}).fill("Long synthetic context");
    await expect(drawer.locator("article")).toHaveCount(1);
    await page.evaluate(()=>{document.documentElement.style.fontSize="200%";});
    await drawer.getByRole("textbox",{name:"Search context",exact:true}).press("Tab");
    expect(await page.evaluate(()=>document.activeElement?.closest("dialog")!==null)).toBe(true);
    await page.screenshot({path:info.outputPath("context-long-200-percent.png")});
    const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent,html:e.parentElement?.outerHTML.slice(0,600),right:e.getBoundingClientRect().right}))}));
    await writeFile(info.outputPath("overflow.json"),JSON.stringify(dimensions));
    expect(dimensions.scroll).toBe(dimensions.width);
    await page.keyboard.press("Escape");await expect(open).toBeFocused();
    await page.evaluate(()=>{document.documentElement.style.fontSize="100%";});
    // Observe live browser animation frames, then rapidly reverse the same drawer.
    await open.click();
    const samples=await page.evaluate(async()=>{
      const rows:{time:number;transform:string;opacity:string}[]=[];
      const start=performance.now();
      while(performance.now()-start<280){const element=document.querySelector(".kernel-context-drawer")!;const style=getComputedStyle(element);rows.push({time:performance.now()-start,transform:style.transform,opacity:style.opacity});await new Promise(requestAnimationFrame);}
      return rows;
    });
    await writeFile(info.outputPath("drawer-motion-frames.json"),JSON.stringify(samples));
    expect(samples.at(-1)?.opacity).toBe("1");
    await page.keyboard.press("Escape");await open.click();await page.keyboard.press("Escape");await open.click();
    await expect(drawer).toBeVisible();await expect(drawer.getByRole("button",{name:"Close context",exact:true})).toBeFocused();
    await page.screenshot({path:info.outputPath("drawer-reopened.png")});
    await drawer.getByRole("textbox",{name:"Search context",exact:true}).fill("Long synthetic context");
    await drawer.getByRole("button",{name:"Forget",exact:true}).click();
    await expect(drawer.getByRole("heading",{name:"Forget this context?",exact:true})).toBeFocused();
    await drawer.getByRole("checkbox",{name:"I understand and want to forget it.",exact:true}).check();
    await drawer.getByRole("button",{name:"Confirm Forget",exact:true}).click();
    await drawer.getByRole("button",{name:"Inspect copies",exact:true}).click();
    await drawer.getByRole("combobox",{name:"Managed backup action",exact:true}).selectOption("retire");
    await drawer.getByRole("checkbox",{name:"Keep the listed backups, accepting that they may contain forgotten content. Disable restore and clean current database pages and temporary files.",exact:true}).check();
    await drawer.getByRole("button",{name:"Retain backups and disable restore",exact:true}).click();
    await expect(drawer.getByRole("status").filter({hasText:"You chose to keep"})).toBeVisible();
    await expect(drawer.locator("article").filter({hasText:"Long synthetic context"})).toHaveCount(0);
    await page.screenshot({path:info.outputPath("backups-retained.png")});
    await page.keyboard.press("Escape");
    await page.emulateMedia({reducedMotion:"reduce"});
    await open.click();
    expect(await drawer.evaluate(element=>getComputedStyle(element).transitionDuration)).toBe("0s");
    await page.keyboard.press("Escape");await expect(open).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe("hidden");
  }finally{await server.close();await fixture.cleanup();}
});

test("G7 built application: history export and explicit conversion retain the old record",async({page},info)=>{
  const fixture=await productionUiProject();
  const opened=await openSestina({databasePath:join(fixture.root,".sestina","state.sqlite")});
  if(!opened.ok) throw new Error(opened.error.code);
  const pilot=opened.value.createClosedExternalAppPilot({projectId:fixture.projectId,evidenceClass:"synthetic_fixture",actor:{kind:"user",actorId:"synthetic-ui-owner"}});
  opened.value.close();
  if(!pilot.ok) throw new Error(pilot.error.code);
  await migrateKernelProject({projectRoot:fixture.root});
  const server=await createResearchRoomServer({languagePreferenceStore:{readLanguage:async()=>"en",writeLanguage:async()=>{}}}).start();
  try {
    await page.setViewportSize({width:1024,height:900});
    await page.goto(server.origin+"/project/kernel");
    await page.getByRole("textbox",{name:"Project folder",exact:true}).fill(fixture.root);
    await page.getByRole("button",{name:"Open project",exact:true}).click();
    await page.getByRole("button",{name:"Historical workflows",exact:true}).click();
    await page.getByRole("combobox",{name:"Record type",exact:true}).selectOption("closed_external_app_pilots");
    await expect(page.getByRole("heading",{name:"Historical record 1",exact:true})).toBeVisible();
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Export this historical record",exact:true}).click();
    const file=await (await download).path();
    if(!file)throw new Error("Export missing");
    const record=JSON.parse(await readFile(file,"utf8"));
    expect(record.legacyPayload.id).toBe(pilot.value.id);
    expect(record.canonicalAuthority).toBe(false);
    await page.screenshot({path:info.outputPath("history-export.png")});
    await page.getByRole("button",{name:"Continue in a new draft",exact:true}).click();
    await page.getByRole("textbox",{name:"What should be reviewed now?",exact:true}).fill("Continue the historical synthetic question in a new review.");
    await page.getByRole("button",{name:"Create linked draft",exact:true}).click();
    await expect(page.getByRole("status").filter({hasText:"Draft saved"})).toBeVisible();
    await page.reload();
    await expect(page.getByRole("textbox",{name:"Suggestion",exact:true})).toHaveValue("Continue the historical synthetic question in a new review.");
  }finally{await server.close();await fixture.cleanup();}
});

test("G6 built application: a missing derived Brief can be explicitly repaired without changing the project",async({page},info)=>{
  const fixture=await productionUiProject();await migrateKernelProject({projectRoot:fixture.root});
  await unlink(join(fixture.root,".sestina","research-brief.yaml"));
  const server=await createResearchRoomServer({languagePreferenceStore:{readLanguage:async()=>"zh-CN",writeLanguage:async()=>{}}}).start();
  try {
    await page.goto(server.origin+"/project/kernel");
    await page.getByRole("textbox",{name:"项目文件夹",exact:true}).fill(fixture.root);
    await page.getByRole("button",{name:"打开项目",exact:true}).click();
    await page.getByText("修复缺失的简报文件",{exact:true}).click();
    await page.screenshot({path:info.outputPath("missing-file-repair.png")});
    await page.getByRole("button",{name:"重建缺失文件并打开",exact:true}).click();
    await expect(page.getByRole("button",{name:"修改简报",exact:true})).toBeVisible();
    expect(JSON.parse(await readFile(join(fixture.root,".sestina","research-brief.yaml"),"utf8")).sourceProjectStateRevision).toBe(1);
  }finally{await server.close();await fixture.cleanup();}
});

test("G6 built application: competing Brief drafts recover a three-way conflict and require fresh confirmation",async({page,context},info)=>{
  const fixture=await productionUiProject();await migrateKernelProject({projectRoot:fixture.root});
  const server=await createResearchRoomServer({languagePreferenceStore:{readLanguage:async()=>"zh-CN",writeLanguage:async()=>{}}}).start();
  const other=await context.newPage();
  const draft=async(p:typeof page,text:string)=>{
    await p.getByRole("button",{name:"修改简报",exact:true}).click();
    await p.getByRole("textbox",{name:"当前任务",exact:true}).fill(text);
    await p.getByRole("textbox",{name:"本次修改的理由",exact:true}).fill("合成项目中的明确用户修改。");
    await p.getByRole("button",{name:"保存草稿",exact:true}).click();
    await p.getByRole("button",{name:"查看修改并确认",exact:true}).click();
  };
  try {
    await page.goto(server.origin+"/project/kernel");
    await page.getByRole("textbox",{name:"项目文件夹",exact:true}).fill(fixture.root);
    await page.getByRole("button",{name:"打开项目",exact:true}).click();
    await draft(page,"候选 A：保留观察性限制。");
    await other.goto(server.origin+"/project/kernel");
    await draft(other,"候选 B：补充来源范围。");
    await other.getByRole("checkbox",{name:"我确认以上具体修改。",exact:true}).check();
    await other.getByRole("button",{name:"确认并保存",exact:true}).click();
    await expect(other.getByRole("status").filter({hasText:"研究变更已保存"})).toBeVisible();
    await page.reload();
    await expect(page.getByText("项目已变化，请重新核对上下文并生成预览。",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"确认并保存",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"继续编辑这份简报草稿",exact:true}).click();
    await page.getByRole("button",{name:"比较当前版本",exact:true}).click();
    await page.getByRole("heading",{name:"比较版本",exact:true}).scrollIntoViewIfNeeded();
    await expect(page.locator(".brief-diff pre").filter({hasText:"候选 A：保留观察性限制。"})).toBeVisible();
    await expect(page.locator(".brief-diff pre").filter({hasText:"候选 B：补充来源范围。"})).toBeVisible();
    await page.screenshot({path:info.outputPath("brief-three-way-conflict.png")});
    await page.getByRole("combobox",{name:"选择采用的内容",exact:true}).selectOption("candidate");
    await page.getByRole("button",{name:"将选择应用到草稿",exact:true}).click();
    await page.getByRole("button",{name:"保存草稿",exact:true}).click();
    await page.getByRole("button",{name:"查看修改并确认",exact:true}).click();
    await expect(page.getByRole("checkbox",{name:"我确认以上具体修改。",exact:true})).not.toBeChecked();
    await page.getByRole("checkbox",{name:"我确认以上具体修改。",exact:true}).check();
    await page.getByRole("button",{name:"确认并保存",exact:true}).click();
    await expect(page.getByRole("status").filter({hasText:"研究变更已保存"})).toBeVisible();
    await page.getByRole("button",{name:"研究简报",exact:true}).click();
    await expect(page.getByText("候选 A：保留观察性限制。",{exact:true})).toBeVisible();
  }finally{await other.close();await server.close();await fixture.cleanup();}
});
