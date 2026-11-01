#!/usr/bin/env node
/** 装配 Release 产物：一个 `tar.gz` + 它的 `sha256`。
 *
 *  ⚠️ **产物是平台无关的**（纯 JS + 一份 wasm），由调用方自己的 node 跑。
 *  名字里**故意不写 `macos-arm64`** —— 它跑在哪都一样，而
 *  **只在 macOS arm64 上实测过**。把「只测过这一个平台」写成「只能用在这一个平台」
 *  是另一种假话，而且是会被人当成读数的那一种。实测范围写在 README。
 *
 *  ⚠️ 产物里**不许有任何图纸**。最后一步逐条扫，发现 `.dwg` / `.dxf` 直接失败 ——
 *  「别忘了删掉测试用的图」是一件需要人记得的事，而需要人记得的事会被忘掉。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const LW = join(ROOT, "node_modules", "@mlightcad", "libredwg-web");
if (!existsSync(LW)) { console.error("✗ 先 npm ci —— node_modules/@mlightcad/libredwg-web 不在"); process.exit(1); }

const STAGE = join(ROOT, "dist", "stage");
const PKG = join(STAGE, "dwg2json");          // tar 里的顶层目录名，解包时 --strip-components=1
rmSync(join(ROOT, "dist"), { recursive: true, force: true });
mkdirSync(join(PKG, "vendor", "libredwg-web"), { recursive: true });

/* ① 转换器本体。**唯一一处改写**：把 npm 包名换成 vendor 的相对路径 ——
      产物里没有 node_modules，而相对 import 不依赖任何解析规则。 */
const src = readFileSync(join(ROOT, "src", "dwg2json.mjs"), "utf8");
const patched = src.replace('from "@mlightcad/libredwg-web"', 'from "./vendor/libredwg-web/lib/index.js"');
if (patched === src) { console.error("✗ 没找到要改写的 import —— 源码动过了，build 要跟着改"); process.exit(1); }
writeFileSync(join(PKG, "dwg2json.mjs"), patched, { mode: 0o755 });

/* ② vendor：只拷运行时真要的。
      ⚠️ `lib/libredwg.js` 用 `import '../wasm/libredwg-web.js'`，而那个 loader
      再按 `import.meta.url` 找 `.wasm` —— 所以这两层的**相对位置不能变**。 */
for (const rel of ["lib", "wasm", "package.json", "README.md"]) {
  cpSync(join(LW, rel), join(PKG, "vendor", "libredwg-web", rel), { recursive: true });
}
// .map / .d.ts 是开发用的，产物里 11 MB 已经够大了
const sweep = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const p = join(d, e.name);
  if (e.isDirectory()) sweep(p);
  else if (/\.(map|d\.ts)$/.test(e.name)) rmSync(p);
} };
sweep(join(PKG, "vendor", "libredwg-web"));

/* ③ 许可必须随产物走 —— GPL 要求分发时带上许可与来源。 */
cpSync(join(ROOT, "LICENSE"), join(PKG, "LICENSE"));
cpSync(join(ROOT, "NOTICE.md"), join(PKG, "NOTICE.md"));
writeFileSync(join(PKG, "VERSION"), `umbra-cad-converter ${version}\n`);

/* ④ 扫一遍：不许有图纸，不许带这台机器的绝对路径。 */
const all = [];
(function rec(d) { for (const e of readdirSync(d, { withFileTypes: true })) {
  const p = join(d, e.name); if (e.isDirectory()) rec(p); else all.push(p);
} })(PKG);
const drawings = all.filter((p) => /\.(dwg|dxf|rvt|skp)$/i.test(p));
if (drawings.length) { console.error("✗ 产物里有图纸：" + drawings.join(" ")); process.exit(1); }
const home = process.env.HOME ?? "/Users";
const leaks = all.filter((p) => /\.(mjs|js|json|md|txt)$/.test(p) && readFileSync(p, "utf8").includes(home));
if (leaks.length) { console.error("✗ 产物里带了本机绝对路径：" + leaks.map((p) => relative(PKG, p)).join(" ")); process.exit(1); }

/* ⑤ 打包。⚠️ 尽量可复现：排序 + 固定 uid/gid/mtime + gzip 不写时间戳。
      **可复现不是整洁** —— Studio 把 sha256 写死在代码里，
      而「同一份源码构建两次得到两个哈希」会让「改没改过」永远说不清。 */
const tarName = `dwg2json-${version}.tar.gz`;
const tarPath = join(ROOT, "dist", tarName);
const files = all.map((p) => relative(STAGE, p)).sort();
writeFileSync(join(ROOT, "dist", "filelist.txt"), files.join("\n") + "\n");
/* ⚠️ **时间戳用 `utimesSync` 定，不用 `tar --mtime`** —— macOS 自带的是 bsdtar 3.5，
   它**没有** `--mtime`（实测「Option --mtime is not supported」）。
   > 一个只在 GNU tar 上存在的选项，在只发 mac 产物的仓库里就是一个必然踩到的坑。
   改在文件上定时间，顺带还是平台无关的。 */
const FIXED = new Date("2026-01-01T00:00:00Z");
const touchAll = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const q = join(d, e.name); if (e.isDirectory()) touchAll(q); utimesSync(q, FIXED, FIXED);
} };
touchAll(STAGE); utimesSync(STAGE, FIXED, FIXED);
execFileSync("tar", [
  "--format", "ustar", "--uid", "0", "--gid", "0", "--numeric-owner",
  "--no-mac-metadata", "--no-xattrs",
  "-C", STAGE, "-cf", join(ROOT, "dist", "pkg.tar"), "-T", join(ROOT, "dist", "filelist.txt"),
], { stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } });
// gzip -n：不把文件名和时间戳写进 gz 头
execFileSync("sh", ["-c", `gzip -9 -n -c "${join(ROOT, "dist", "pkg.tar")}" > "${tarPath}"`], { stdio: "inherit" });
rmSync(join(ROOT, "dist", "pkg.tar"));
rmSync(join(ROOT, "dist", "filelist.txt"));
rmSync(STAGE, { recursive: true, force: true });

const sha = createHash("sha256").update(readFileSync(tarPath)).digest("hex");
writeFileSync(`${tarPath}.sha256`, `${sha}  ${tarName}\n`);
console.log(`✓ dist/${tarName}  ${statSync(tarPath).size} 字节`);
console.log(`  sha256  ${sha}`);
console.log(`\n把这两个文件传成 v${version} 的 Release 资产，并把 sha256 写进 Studio 的 server/src/cad/install.ts。`);
