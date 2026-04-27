export interface VersionValue {
  version: string;
}

export function versionText(v: VersionValue): string {
  return `grove version ${v.version}`;
}

export function versionPorcelain(v: VersionValue): string {
  return v.version;
}
