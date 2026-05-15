import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

type BumpType = "patch" | "minor" | "major";

const BUMP_TYPES: BumpType[] = ["patch", "minor", "major"];

function usage(): never {
  console.error(`Usage: bun run release <patch|minor|major>`);
  process.exit(1);
}

function bumpVersion(version: string, bump: BumpType): string {
  const parts = version.split(".").map(Number);
  const [major, minor, patch] = [parts[0]!, parts[1]!, parts[2]!];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function run(cmd: string): void {
  execSync(cmd, { stdio: "inherit" });
}

const bump = process.argv[2] as BumpType;
if (!BUMP_TYPES.includes(bump)) usage();

const pkgPath = new URL("../package.json", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const currentVersion: string = pkg.version;
const nextVersion = bumpVersion(currentVersion, bump);
const tag = `v${nextVersion}`;

console.log(`Bumping ${currentVersion} → ${nextVersion} (${bump})`);

pkg.version = nextVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

run(`git add package.json`);
run(`git commit -m "chore(release): ${tag}"`);
run(`git tag -a ${tag} -m "chore(release): ${tag}"`);
run(`git push origin main --follow-tags`);

console.log(`Released ${tag}`);
