#!/usr/bin/env node
/** 契约自测。**一份 dwg 都不需要** —— 为什么见 `fixtures/README.md`。
 *
 *  ⚠️ 它测两样东西，而第二样容易被忘：
 *  ① 源码按契约答话（`--version` / 参数不全 / 文件读不了）；
 *  ② **装配出来的产物**也按契约答话 —— 产物里的 import 是构建脚本改写过的，
 *     改写错了的症状是「源码跑得好好的，而发出去那一份一启动就炸」。
 */
import { execFileSync, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
let pass = 0; const bad = [];
const ok = (c, what, detail = "") => { if (c) { pass++; console.log(`  ✓ ${what}${detail ? `  ${detail}` : ""}`); } else { bad.push(what); console.log(`  ✗ ${what}${detail ? `  ${detail}` : ""}`); } };
/** 跑一次，**退出码和两条流都要**（只看退出码分不清「读不了」和「跑不起来」）。 */
const call = async (exe, args) => {
  try { const r = await run(process.execPath, [exe, ...args], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }); return { code: 0, out: r.stdout, err: r.stderr }; }
  catch (e) { return { code: e.code ?? -1, out: String(e.stdout ?? ""), err: String(e.stderr ?? e.message ?? "") }; }
};

async function contract(label, exe) {
  console.log(`\n${label}`);
  const v = await call(exe, ["--version"]);
  ok(v.code === 0 && v.out.trim().split("\n").length === 1 && v.out.trim().length > 0,
     "`--version` 回一行版本、退出码 0", JSON.stringify(v.out.trim()));
  /* ⚠️ 版本串里**要有 GPL 字样** —— 它是用户唯一看得见「这是另一个程序、另一个许可」
     的地方（Studio 的「组件信息」里直接显示它）。 */
  ok(/GPL/i.test(v.out), "版本串里说得出它的许可", v.out.trim());

  const n = await call(exe, []);
  ok(n.code !== 0 && /用法|usage/i.test(n.err), "参数不全 → 非 0 退出码 + stderr 给用法",
     `code=${n.code} err=${JSON.stringify(n.err.trim().slice(0, 60))}`);

  const box = mkdtempSync(join(tmpdir(), "ucc-self-"));
  const miss = await call(exe, ["--in", join(box, "不存在.dwg"), "--out", join(box, "o.json")]);
  /* ⚠️ 判准是**「说了为什么」**，不只是「失败了」。
     一句没有内容的错误信息比没有错误信息更糟：它看起来像已经解释过了。 */
  ok(miss.code !== 0 && miss.err.trim().length > 0,
     "**文件不存在 → 非 0 + stderr 不是空的**（空的话调用方没法转述）",
     `code=${miss.code} err=${JSON.stringify(miss.err.trim().slice(0, 80))}`);
  ok(!existsSync(join(box, "o.json")), "读不了的时候**一个输出文件都没留下**（半份 JSON 比没有糟）");

  const junk = join(box, "假的.dwg");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(junk, Buffer.from("这不是 dwg，只是一串字"), "utf8");
  const j = await call(exe, ["--in", junk, "--out", join(box, "j.json")]);
  ok(j.code !== 0 && j.err.trim().length > 0, "**喂一份不是 dwg 的文件 → 非 0 + 说得出话**（不是崩在栈里）",
     `code=${j.code} err=${JSON.stringify(j.err.trim().slice(0, 80))}`);
}

console.log("umbra-cad-converter 契约自测");
await contract("① 源码（src/dwg2json.mjs）", join(ROOT, "src", "dwg2json.mjs"));

/* ── ② 装配出来的产物 ── */
console.log("\n② 产物（dist/ 解包之后）");
const dist = join(ROOT, "dist");
const tar = existsSync(dist) ? readdirSync(dist).find((f) => /^dwg2json-.*\.tar\.gz$/.test(f)) : undefined;
if (!tar) {
  console.log("  — 没有 dist/*.tar.gz，这一节整块跳过（先 `npm run build`）");
  console.log("  ⚠️ **跳过不算通过** —— 发版前必须跑过这一节，不然改写 import 错了没人知道");
} else {
  const box = mkdtempSync(join(tmpdir(), "ucc-pkg-"));
  execFileSync("tar", ["-xzf", join(dist, tar), "-C", box, "--strip-components", "1"], { stdio: "inherit" });
  ok(existsSync(join(box, "dwg2json.mjs")), "产物里有 `dwg2json.mjs`");
  ok(existsSync(join(box, "LICENSE")) && existsSync(join(box, "NOTICE.md")),
     "**许可和归属随产物走**（GPL 要求分发时带上）");
  ok(!existsSync(join(box, "node_modules")), "产物里**没有 `node_modules`**（vendor 是拷进去的）");
  ok(existsSync(join(box, "vendor", "libredwg-web", "wasm", "libredwg-web.wasm")),
     "wasm 在 `vendor/libredwg-web/wasm/` 下（loader 按相对位置找它）");
  const files = []; (function rec(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) rec(p); else files.push(p); } })(box);
  ok(!files.some((f) => /\.(dwg|dxf)$/i.test(f)), "**产物里一份图纸都没有**");
  ok(!files.some((f) => /\.(map|d\.ts)$/.test(f)), "`.map` 与 `.d.ts` 没跟着进产物");
  const sha = createHash("sha256").update(readFileSync(join(dist, tar))).digest("hex");
  const said = readFileSync(join(dist, `${tar}.sha256`), "utf8").trim().split(/\s+/)[0];
  ok(sha === said, "**`.sha256` 文件里写的就是这个包的哈希**（Studio 要按它校验）", `${sha.slice(0, 16)}…`);
  /* ⚠️ 产物也要过**同一套契约** —— 这一节的全部意义在这里。 */
  await contract("  产物的契约（和源码同一套判据）", join(box, "dwg2json.mjs"));
  console.log(`\n  产物 ${statSync(join(dist, tar)).size} 字节 · 解包 ${files.length} 个文件`);
}

console.log(`\n${bad.length === 0 ? "✓" : "✗"} 契约自测 ${pass}/${pass + bad.length}`);
if (bad.length) { bad.forEach((b) => console.log(`  ✗ ${b}`)); process.exit(1); }
