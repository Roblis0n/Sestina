import { useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import {
  decodeLocalJson,
  decodeReview,
  type KernelReviewDto,
} from "../../api/kernel-dto.js";
import { Button } from "../primitives/Button.js";

export function KernelConnectionsPanel({
  projectId,
  en,
  onReview,
}: {
  projectId: string;
  en: boolean;
  onReview: (review: KernelReviewDto) => void;
}) {
  const [envelope, setEnvelope] = useState("");
  const [connection, setConnection] = useState<{
    origin: string;
    token: string;
    expiresAt: string;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch {
      setError(
        en
          ? "This action did not complete. Check the source and retry explicitly."
          : "操作未完成，请核对来源后再试。 ",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h1>{en ? "Draft connections" : "草稿连接"}</h1>
      <p>
        {en
          ? "Imported suggestions stay drafts. Connections cannot send assessments, edit research objects, or confirm changes. File references are labels; importing does not read files."
          : "导入建议只保存为草稿。连接不能发送评估、修改研究对象或确认变更。文件引用仅作来源提示，导入不会读取文件。"}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <details>
        <summary>{en ? "Import a structured draft" : "导入结构化草稿"}</summary>
        <label>
          {en ? "Paste the draft envelope" : "粘贴草稿封装内容"}
          <textarea
            value={envelope}
            onChange={(e) => {
              setEnvelope(e.target.value);
            }}
            maxLength={131072}
            spellCheck={false}
          />
        </label>
        <Button
          disabled={busy || !envelope.trim()}
          onClick={() =>
            void run(async () => {
              const draft = await researchRoomApi.kernel(
                projectId,
                "import_envelope",
                { envelope: JSON.parse(envelope) },
                decodeReview,
              );
              setEnvelope("");
              onReview(draft);
            })
          }
        >
          {en ? "Import as draft" : "导入为草稿"}
        </Button>
      </details>
      <h2>{en ? "Temporary Host connection" : "临时 Host 连接"}</h2>
      <p>
        {en
          ? "Off by default. Enable only when you want a local Host to submit a draft. Access expires after ten minutes and ends when the project closes."
          : "默认关闭。需要本地 Host 提交草稿时才启用。授权十分钟后失效，关闭项目也会结束连接。"}
      </p>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setConnection(
              (await researchRoomApi.kernel(
                projectId,
                "enable_host_bridge",
                {},
                decodeLocalJson,
              )) as unknown as NonNullable<typeof connection>,
            );
          })
        }
      >
        {en ? "Enable temporary connection" : "启用临时连接"}
      </Button>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await researchRoomApi.kernel(
              projectId,
              "revoke_host_bridge",
              {},
              decodeLocalJson,
            );
            setConnection(undefined);
          })
        }
      >
        {en ? "Revoke connection" : "撤销连接"}
      </Button>
      {connection ? (
        <section>
          <p>
            {en ? "Valid until" : "有效期至"}{" "}
            {new Date(connection.expiresAt).toLocaleString(en ? "en" : "zh-CN")}
          </p>
          <p>
            {en
              ? "Give these details only to the local Host you intend to connect. The token is shown only in this view."
              : "仅将以下信息交给你要连接的本地 Host。令牌只在此处显示。"}
          </p>
          <dl>
            <dt>{en ? "Address" : "地址"}</dt>
            <dd>
              <code>{connection.origin}</code>
            </dd>
            <dt>{en ? "Draft access token" : "草稿访问令牌"}</dt>
            <dd>
              <code>{connection.token}</code>
            </dd>
          </dl>
        </section>
      ) : null}
    </section>
  );
}
