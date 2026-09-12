import type {
  DesktopBridge,
  DesktopMethod,
  DesktopReply,
  KernelCommandRequest,
} from "@sestina/application-ports";
declare global {
  interface Window {
    readonly sestinaDesktop?: DesktopBridge;
  }
}
export const desktop = () => window.sestinaDesktop;
export async function desktopRequest(
  path: string,
  method: string,
  body: unknown,
): Promise<DesktopReply> {
  const bridge = desktop();
  if (!bridge) throw new Error("desktop_unavailable");
  if (path === "/api/kernel/reviews") {
    const request = body as KernelCommandRequest;
    const command = (bridge.commands as Partial<typeof bridge.commands>)[
      request.action
    ];
    if (!command) throw new Error("invalid_payload");
    return command(request);
  }
  const map: Record<string, DesktopMethod> = {
    "/api/status": "status",
    "/api/preferences/language": "language",
    "/api/kernel/status": "kernelStatus",
    "/api/kernel/open": "open",
    "/api/kernel/create": "createProject",
    "/api/kernel/close": "closeProject",
    "/api/kernel/maintenance": "maintenance",
    "/api/kernel/repair-brief": "repairBrief",
  };
  if (map[path]) return bridge.methods[map[path]](body);
  const provider =
    /^\/api\/(second-opinion-provider|provider)(\/config|\/secret)?$/.exec(
      path,
    );
  if (provider) {
    const action =
      method === "GET"
        ? "providerStatus"
        : method === "POST"
          ? "providerSave"
          : provider[2] === "/secret"
            ? "providerDeleteSecret"
            : "providerDeleteConfig";
    return bridge.methods[action]({
      second: provider[1] === "second-opinion-provider",
      ...(body ? { input: body } : {}),
    });
  }
  return {
    ok: false,
    error: { code: "desktop_method_unavailable", reasons: [] },
  };
}
