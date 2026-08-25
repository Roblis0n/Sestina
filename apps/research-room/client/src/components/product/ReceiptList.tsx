import { useState } from "react";
import type { AppLanguage, ResearchRoomReceiptDto } from "../../api/dto.js";
import { localizedError, t } from "../../i18n/copy.js";
import { Button } from "../primitives/Button.js";
import { Modal } from "../primitives/Modal.js";
import { StatusBadge } from "../primitives/StatusBadge.js";

interface ReceiptListProps {
  readonly language: AppLanguage;
  readonly receipts: readonly ResearchRoomReceiptDto[];
  readonly busy: boolean;
  readonly onInspect: (receipt: ResearchRoomReceiptDto) => void;
  readonly onOpenTrace: (receipt: ResearchRoomReceiptDto) => void;
  readonly onDownload: (receipt: ResearchRoomReceiptDto) => Promise<void>;
  readonly onRollback: (receipt: ResearchRoomReceiptDto, reason: string) => Promise<void>;
  readonly onError: (message: string) => void;
}

export function ReceiptList({ language, receipts, busy, onInspect, onOpenTrace, onDownload, onRollback, onError }: ReceiptListProps) {
  const [rollback, setRollback] = useState<ResearchRoomReceiptDto>();
  const [reason, setReason] = useState("");
  async function confirmRollback() {
    if (!rollback || !reason.trim()) return;
    try { await onRollback(rollback, reason.trim()); setRollback(undefined); setReason(""); }
    catch (error) { onError(localizedError(language, error)); }
  }
  return <section className="receipt-list" aria-labelledby="receipts-heading">
    <div className="section-heading"><div><p className="eyebrow">RECEIPTS</p><h2 id="receipts-heading">{t(language, "receipts")}</h2></div><span>{receipts.length}</span></div>
    {receipts.length === 0 ? <p className="empty-state">{t(language, "no_receipts")}</p> : <ol>{receipts.map((receipt) => <li key={receipt.id}>
      <button data-inspector-return type="button" className="receipt-summary" onClick={() => { onInspect(receipt); }}>
        <span><strong>{receipt.disposition.kind}</strong><small>{receipt.id}</small></span>
        <StatusBadge tone={receipt.status === "committed" ? "ready" : "warning"}>{receipt.status}</StatusBadge>
      </button>
      <div className="receipt-actions"><Button type="button" variant="quiet" disabled={busy} onClick={() => { onOpenTrace(receipt); }}>{language === "en" ? "Open trace" : "打开 Trace"}</Button><Button type="button" variant="quiet" disabled={busy} onClick={() => void onDownload(receipt)}>{t(language, "download_receipt")}</Button>{receipt.rollback.available ? <Button type="button" variant="quiet" disabled={busy} onClick={() => { setRollback(receipt); }}>{t(language, "rollback")}</Button> : null}</div>
    </li>)}</ol>}
    <Modal open={rollback !== undefined} title={t(language, "rollback")} description={rollback?.id} closeLabel={t(language, "close")} onClose={() => { setRollback(undefined); }}>
      <label htmlFor="rollback-reason">{t(language, "rollback_reason")}</label><textarea id="rollback-reason" required maxLength={4096} value={reason} onChange={(event) => { setReason(event.target.value); }} />
      <div className="button-row"><Button type="button" variant="danger" disabled={busy || !reason.trim()} onClick={() => void confirmRollback()}>{t(language, "rollback_confirm")}</Button><Button type="button" variant="secondary" onClick={() => { setRollback(undefined); }}>{t(language, "cancel")}</Button></div>
    </Modal>
  </section>;
}
