export declare function collectSourceKeys(srcRoot?: string): Set<string>;
export declare function collectLocaleEntries(file: string): Map<string, string>;
export declare function checkLocale(
  localeFile: string,
  srcRoot?: string,
): {
  missing: string[];
  stale: string[];
  emDash: string[];
  checked: number;
};
