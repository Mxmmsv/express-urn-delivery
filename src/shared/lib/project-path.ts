import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function getProjectPath(...segments: string[]): string {
  return resolve(projectRoot, ...segments);
}
