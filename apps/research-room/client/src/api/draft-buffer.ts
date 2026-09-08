/** Local editing state only; neither authority nor crash recovery. */
export class DraftBuffer {
  text = "";
  baseText = "";
  baseVersion = 0;
  serverText = "";
  serverVersion = 0;
  get dirty() {
    return this.text !== this.baseText;
  }
  get conflict() {
    return (
      this.dirty &&
      this.serverVersion !== this.baseVersion &&
      this.serverText !== this.baseText
    );
  }
  receive(text: string, version: number, redacted = false) {
    if (version < this.serverVersion) return;
    if (redacted) {
      this.text = "";
      this.baseText = "";
      this.baseVersion = version;
    } else if (!this.baseVersion || !this.dirty) {
      this.text = text;
      this.baseText = text;
      this.baseVersion = version;
    }
    this.serverText = redacted ? "" : text;
    this.serverVersion = version;
  }
  saved(text: string, version: number) {
    if (version < this.serverVersion) return;
    this.baseText = text;
    this.baseVersion = version;
    this.serverText = text;
    this.serverVersion = version;
  }
  discard() {
    this.text = this.serverText;
    this.baseText = this.serverText;
    this.baseVersion = this.serverVersion;
  }
  keepLocalAgainstCurrent() {
    this.baseText = this.serverText;
    this.baseVersion = this.serverVersion;
  }
}
