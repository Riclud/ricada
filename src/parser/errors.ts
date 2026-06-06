export class ParseError extends Error {
  constructor(
    public type: string,
    message: string,
    public line: number,
    public col: number,
    public length: number = 1,
    public hint?: string,
  ) {
    super(message);
    this.name = "ParseError";
  }

  format(sourceLines: string[]): string {
    const line = sourceLines[this.line - 1] ?? "";
    const lineNum = String(this.line);
    const pad = " ".repeat(lineNum.length);

    let out = "";
    out += `${this.type}: ${this.message}\n`;
    out += ` ${"-->"} ricada:${this.line}:${this.col}\n`;
    out += ` ${pad} |\n`;
    out += ` ${lineNum} | ${line}\n`;
    out += ` ${pad} | ${" ".repeat(this.col - 1)}${"^".repeat(this.length)} ${this.message}`;
    if (this.hint) {
      out += `\n ${pad} |\n`;
      out += ` ${pad} = hint: ${this.hint}`;
    }
    return out;
  }
}
