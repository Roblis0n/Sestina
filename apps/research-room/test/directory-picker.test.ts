import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { createNativeDirectoryPicker, type DirectoryPickerCommandRunner } from "../src/directory-picker.js";

describe("RI-48 native directory picker adapter", () => {
  it("uses a static Windows STA FolderBrowserDialog command and returns only its selected directory", async () => {
    let observed: { readonly executable: string; readonly args: readonly string[] } | undefined;
    const runner: DirectoryPickerCommandRunner = {
      run: (request) => {
        observed = { executable: request.executable, args: request.args };
        return Promise.resolve({ exitCode: 0, stdout: "C:\\selected-research\r\n" });
      },
    };
    const picker = createNativeDirectoryPicker({ platform: "win32", runner });
    expect(picker).toBeDefined();

    await expect(picker?.pick(new AbortController().signal)).resolves.toBe("C:\\selected-research");
    expect(observed?.executable).toBe("powershell.exe");
    expect(observed?.args).toContain("-STA");
    const encoded = observed?.args.at(-1);
    expect(typeof encoded).toBe("string");
    const command = Buffer.from(encoded ?? "", "base64").toString("utf16le");
    expect(command).toContain("System.Windows.Forms.FolderBrowserDialog");
    expect(command).not.toContain("C:\\selected-research");
  });

  it("maps an empty successful result to user cancellation", async () => {
    const picker = createNativeDirectoryPicker({
      platform: "win32",
      runner: { run: () => Promise.resolve({ exitCode: 0, stdout: "  \r\n" }) },
    });
    await expect(picker?.pick(new AbortController().signal)).resolves.toBeUndefined();
  });

  it("fails with a stable path-free error and stays unavailable on unsupported hosts", async () => {
    const picker = createNativeDirectoryPicker({
      platform: "win32",
      runner: { run: () => Promise.resolve({ exitCode: 7, stdout: "C:\\private\\research" }) },
    });
    await expect(picker?.pick(new AbortController().signal)).rejects.toThrow("The system folder picker could not be opened.");
    expect(createNativeDirectoryPicker({ platform: "linux" })).toBeUndefined();
  });
});
