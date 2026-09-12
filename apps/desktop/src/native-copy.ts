import type { TrustedConfirmation } from "@sestina/application";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const quotedField = (value: unknown) =>
  JSON.stringify(typeof value === "string" ? value : "");
export function confirmationCopy(input: TrustedConfirmation, language: string) {
  const en = language === "en";
  const labels: Record<string, readonly [string, string, string, string]> = {
    commit: [
      "保存这次研究决定？",
      "Save this research decision?",
      "保存决定",
      "Save decision",
    ],
    start_attempt: [
      "发送已核对的内容？",
      "Send the checked content?",
      "发送本次请求",
      "Send this request",
    ],
    govern_memory: [
      "保存这次记忆修改？",
      "Save this memory change?",
      "保存记忆修改",
      "Save memory change",
    ],
    privacy_cleanup: [
      "清理列出的受管副本？",
      "Clean up the listed managed copies?",
      "清理这些副本",
      "Clean up these copies",
    ],
    enable_host_bridge: [
      "允许临时接收草稿？",
      "Allow temporary draft intake?",
      "允许接收草稿",
      "Allow draft intake",
    ],
  };
  const label = labels[input.action];
  if (!label) throw new Error("invalid_confirmation_action");
  const saved = object(input.snapshot),
    read = object(saved.read),
    review = object(read.review),
    manifest = object(saved.manifest),
    provider = object(manifest.provider);
  const detail: string[] = [(en ? "Project: " : "项目：") + input.projectId];
  if (input.action === "commit" || input.action === "start_attempt") {
    detail.push(
      (en ? "Review: " : "审议：") + String(review.id),
      (en ? "Saved draft version: " : "已保存草稿版本：") +
        String(review.version),
    );
  }
  if (input.action === "commit") {
    const effects: Record<string, readonly [string, string]> = {
      patch_brief: ["修改 Brief", "Change Brief"],
      create_decision: ["保存决定", "Save decision"],
      create_or_resolve_issue: ["记录或处理问题", "Record or resolve issue"],
      add_evidence: ["添加证据", "Add evidence"],
      formal_direction_change: ["调整研究方向", "Change research direction"],
      record_only: ["仅记录本次处理结果", "Record this outcome only"],
    };
    const effect = object(review.effectDraft);
    const kind = String(effect.effectKind ?? object(effect.payload).kind);
    detail.push(
      (en ? "Change: " : "修改：") +
        (effects[kind]?.[en ? 1 : 0] ??
          (en ? "The checked research change" : "已核对的研究修改")),
    );
    detail.push(
      en
        ? "This saves your decision. It does not establish that a research claim is true."
        : "这会保存你的决定，不表示研究主张已得到证实。",
    );
  } else if (input.action === "start_attempt") {
    detail.push(
      (en ? "Destination: " : "发送目标：") + quotedField(provider.origin),
      (en ? "Model: " : "模型：") + quotedField(provider.model),
      (en
        ? "Exact request size (UTF-8 bytes): "
        : "精确请求大小（UTF-8 字节）：") + String(manifest.exactRequestBytes),
    );
    detail.push(
      en
        ? "The selected research content will leave this application. The full request is listed in the Review. This sends it once; an uncertain result will not be resent automatically."
        : "已选择的研究内容将发出本应用。完整请求列在审议页。本次只发送一次；结果不确定时不会自动重发。",
    );
    detail.push(
      (en ? "Request hash: " : "请求核对标识：") +
        String(manifest.exactRequestHash),
    );
  } else if (input.action === "privacy_cleanup")
    detail.push(
      en
        ? "The listed deletion cannot be undone here. Copies outside the managed scope are not included."
        : "列出的删除无法在此撤销。受管范围之外的副本不在本次清理中。",
    );
  else if (input.action === "govern_memory")
    detail.push(
      en
        ? "Memory stays context, not Evidence. Forgetting clears the selected local content; managed copies may require separate cleanup."
        : "记忆仍是上下文，不会变成证据。忘记操作会清除所选本地内容；受管副本可能还需单独清理。",
    );
  else
    detail.push(
      en
        ? "For 10 minutes, the holder can submit drafts and read their status. It cannot send to a Provider or save research decisions. Closing the project or restarting disables access."
        : "10 分钟内，持有者可提交草稿并查看其状态，不能调用模型服务或保存研究决定。关闭项目或重启后，访问立即失效。",
    );
  detail.push(
    (en ? "Confirmation binding: " : "本次确认标识：") + input.bindingHash,
  );
  return {
    message: label[en ? 1 : 0],
    detail: detail.join("\n\n"),
    buttons: [en ? "Cancel" : "取消", label[en ? 3 : 2]],
  };
}
