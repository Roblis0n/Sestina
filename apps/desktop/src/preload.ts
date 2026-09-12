import { contextBridge, ipcRenderer } from "electron";
import { KERNEL_COMMANDS, DESKTOP_METHODS } from "@sestina/application-ports";
const methods = Object.fromEntries(
  DESKTOP_METHODS.map((name) => [
    name,
    (input?: unknown) => ipcRenderer.invoke(`sestina:method:${name}`, input),
  ]),
);
const commands = Object.fromEntries(
  KERNEL_COMMANDS.map((name) => [
    name,
    (input: unknown) => ipcRenderer.invoke(`sestina:command:${name}`, input),
  ]),
);
contextBridge.exposeInMainWorld(
  "sestinaDesktop",
  Object.freeze({
    methods: Object.freeze(methods),
    commands: Object.freeze(commands),
    onCloseRequested(listener: () => void) {
      const callback = () => {
        listener();
      };
      ipcRenderer.on("sestina:close-requested", callback);
      return () =>
        ipcRenderer.removeListener("sestina:close-requested", callback);
    },
  }),
);
