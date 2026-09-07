import { useEffect, useRef, useState } from "react";
import { Modal } from "../primitives/Modal.js";
import { Button } from "../primitives/Button.js";
import { KernelMemoryPanel } from "./KernelMemoryPanel.js";

export function KernelMemoryDrawer({ projectId, en }: { projectId: string; en: boolean }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return <>
    <Button ref={trigger} onClick={() => { setVisited(true); setOpen(true); }}>{en ? "Manage project context" : "管理项目上下文"}</Button>
    <Modal open={open} title={en ? "Project context" : "项目上下文"} description={en ? "Manage reusable context here. Select it separately for each request; it is never Evidence." : "在这里维护可复用上下文。每次请求另行选择，它不作为证据。"} closeLabel={en ? "Close context" : "关闭上下文"} onClose={() => { setOpen(false); }} returnFocusRef={trigger} className="kernel-context-drawer">
      {visited ? <KernelMemoryPanel projectId={projectId} en={en} embedded/> : null}
    </Modal>
  </>;
}
