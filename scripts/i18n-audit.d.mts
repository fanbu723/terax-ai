export declare const SRC_ROOT: string;
export declare function auditSource(srcRoot?: string): {
  file: string;
  line: number;
  kind: string;
  text: string;
}[];
