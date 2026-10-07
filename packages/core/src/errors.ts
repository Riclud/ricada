import type { Location } from "./tokens.ts";

export class RicadaError extends Error {
  constructor(
    message: string,
    public loc: Location,
    public length = 1,
    public hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }

  format(sourceLines: string[]): string {
    const line = sourceLines[this.loc.line - 1] ?? "";
    const lineNum = String(this.loc.line);
    const pad = " ".repeat(lineNum.length);

    let out = "";
    out += `${this.name}: ${this.message}\n`;
    out += ` --> ricada:${this.loc.line}:${this.loc.col}\n`;
    out += ` ${pad} |\n`;
    out += ` ${lineNum} | ${line}\n`;
    out += ` ${pad} | ${" ".repeat(this.loc.col - 1)}${"^".repeat(this.length)} ${this.message}`;
    if (this.hint) {
      out += `\n ${pad} |\n`;
      out += ` ${pad} = hint: ${this.hint}`;
    }
    return out;
  }
}

export class LexError extends RicadaError {}
