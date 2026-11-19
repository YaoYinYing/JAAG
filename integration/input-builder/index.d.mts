/** Transport-independent snapshot metadata; scientific document uses jaag-superset v1. */
export interface DependencySlot {
  id: string;
  kind: string;
  slot: Array<string | number>;
}
export interface DependencyMetadata extends DependencySlot {
  name: string;
  size: number;
  sha256: string;
  mime: string;
}
export interface DependencyFile extends DependencyMetadata {
  path: string;
  bytes: Uint8Array;
}
export interface InputSnapshot {
  builder: 'bionuta';
  builderVersion: 2;
  documentSchemaVersion: 1;
  target: string;
  revision: number;
  document: Record<string, unknown>;
  authoring: unknown[];
  manualBondCount: number;
  customComponents: Record<string, unknown>;
  dependencies: DependencyMetadata[];
}
export type CaptureResolver = (slot: DependencySlot, context: { signal: AbortSignal }) =>
  { name: string; mime?: string; bytes: Uint8Array } | null | Promise<{ name: string; mime?: string; bytes: Uint8Array } | null>;
export type RestoreResolver = (slot: DependencyMetadata, context: { signal: AbortSignal }) => Uint8Array | Promise<Uint8Array>;
export interface InputBuilder {
  readonly version: 1;
  validate(): Promise<{ valid: boolean; errors: string[]; warnings: string[]; revision: number }>;
  listDependencies(): Promise<DependencySlot[]>;
  snapshot(resolver?: CaptureResolver): Promise<{ snapshot: InputSnapshot; files: DependencyFile[] }>;
  materialize(resolver?: CaptureResolver): Promise<{
    snapshot: InputSnapshot;
    revision: number;
    output: { role: 'input'; name: string; mime: string; bytes: Uint8Array; sha256: string };
    dependencies: DependencyFile[];
    diagnostics: { errors: string[]; warnings: string[] };
  }>;
  restore(snapshot: InputSnapshot, resolver?: RestoreResolver): Promise<void>;
  subscribe(listener: (event: { revision: number }) => void): () => void;
  destroy(): void;
}
/** Mounts the full workbench in an isolated, trusted same-origin iframe. */
export function mount(container: Element, options: { target: string; editorURL?: string | URL }): Promise<InputBuilder>;
