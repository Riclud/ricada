import type { Ir } from "./ir.ts";

export interface EmittedFile {
  path: string;
  contents: string;
}

export interface Emitter {
  name: string;
  emit(ir: Ir): EmittedFile[];
}
