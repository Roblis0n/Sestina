import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
/** The OS entry dialog sends its value only to main, never to research webContents. */
export async function requestCredential(
  language: string,
): Promise<string | undefined> {
  if (process.platform !== "win32") {
    try {
      const command =
        process.platform === "darwin" ? "/usr/bin/osascript" : "zenity";
      const args =
        process.platform === "darwin"
          ? [
              "-e",
              'text returned of (display dialog "Enter the Sestina API key" default answer "" with hidden answer buttons {"Cancel", "Use this key"} default button "Use this key")',
            ]
          : ["--password", "--title=Sestina API key"];
      return (
        (
          await execute(command, args, { timeout: 120000, maxBuffer: 16384 })
        ).stdout.trim() || undefined
      );
    } catch {
      throw new Error("native_credential_entry_unavailable");
    }
  }
  const en = language === "en";
  const source = `Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Sestina'; $form.Width = 520; $form.Height = 205; $form.StartPosition = 'CenterScreen'; $form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = '${en ? "Enter the API key. It stays outside the research window." : "输入 API 密钥。密钥不会进入研究窗口。"}'; $label.SetBounds(18,18,470,36)
$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true; $inputBox.MaxLength = 8192; $inputBox.SetBounds(18,58,470,28)
$save = New-Object System.Windows.Forms.Button
$save.Text = '${en ? "Use this key" : "使用此密钥"}'; $save.SetBounds(270,104,110,30); $save.DialogResult = [System.Windows.Forms.DialogResult]::OK
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '${en ? "Cancel" : "取消"}'; $cancel.SetBounds(390,104,90,30); $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.AddRange(@($label,$inputBox,$save,$cancel)); $form.AcceptButton = $save; $form.CancelButton = $cancel
$result = $form.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($inputBox.Text))) }
$inputBox.Clear(); $form.Dispose()`;
  try {
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-EncodedCommand",
        Buffer.from(source, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 120000, maxBuffer: 16384 },
    );
    return stdout
      ? Buffer.from(stdout.trim(), "base64").toString("utf8")
      : undefined;
  } catch {
    throw new Error("native_credential_entry_unavailable");
  }
}
