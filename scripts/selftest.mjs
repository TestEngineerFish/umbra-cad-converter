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

/* ── ③ 实体映射（0.1.1 起可测）──
   ⚠️ **这一节一份 dwg 都不用**：`ent()` 搬进 `src/ent.mjs` 之后，喂几个**形状像 libredwg**
   的自拟对象就能验。字段名取自 libredwg-web 0.8.3 自己的类型声明。
   ⚠️ 为什么非要有这一节：这一段是整个转换器里唯一有分支的地方，而它历史上的三个毛病
   （`POLYLINE2D` 写成 `POLYLINE` 吃掉 52 条线 · `ATTRIB` 的嵌套 `text` 变成 `[object Object]` ·
   **`ELLIPSE` 整支缺失，一张真图上 19 个全进 unknown**）**全都只在真图上露脸**。
   > 一段只能靠真图才验得到的映射，等于一段没有判据的代码。 */
console.log("\n③ 实体映射（自拟数据，不用 dwg）");
{
  const { ent } = await import("../src/ent.mjs");
  /* 整椭圆：参数**原样吐出去**，不在这一侧离散（口径：转换器笨、Studio 聪明） */
  const full = ent({ type: "ELLIPSE", layer: "家具", center: { x: 1000, y: 2000 },
    majorAxisEndPoint: { x: 500, y: 0 }, axisRatio: 0.5, startAngle: 0, endAngle: Math.PI * 2 });
  ok(full && full.t === "ELLIPSE" && full.c[0] === 1000 && full.ma[0] === 500 && full.ratio === 0.5
     && full.a0 === 0 && Math.abs(full.a1 - Math.PI * 2) < 1e-9,
     "**ELLIPSE 出来了**，中心 / 长轴向量 / 轴比 / 起止参数原样", JSON.stringify(full));
  ok(full && !("segments" in full) && !("v" in full),
     "**这一侧不离散**（没有折线点，只有参数）—— 每段几度是 Studio 的取舍");
  const arc = ent({ type: "ELLIPSE", layer: "L", center: { x: 0, y: 0 },
    majorAxisEndPoint: { x: 100, y: 0 }, axisRatio: 0.25, startAngle: 1, endAngle: 2 });
  ok(arc && arc.a0 === 1 && arc.a1 === 2, "椭圆弧（起止参数不是 0..2π）照样吐", JSON.stringify(arc));
  /* 退化的不吐：轴比 0 / 长轴零向量 —— 吐出去后面除它会出 NaN */
  ok(ent({ type: "ELLIPSE", center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 100, y: 0 }, axisRatio: 0 }) === null,
     "轴比 0 的退化椭圆不吐（它不是椭圆，而且后面除它会出 NaN）");
  ok(ent({ type: "ELLIPSE", center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 0, y: 0 }, axisRatio: 1 }) === null,
     "长轴是零向量的也不吐");
  const mir = ent({ type: "ELLIPSE", center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 100, y: 0 },
    axisRatio: 1, startAngle: 0, endAngle: 1, extrusionDirection: { x: 0, y: 0, z: -1 } });
  ok(mir && mir.ez === -1, "挤出方向不是默认的 (0,0,1) 时带出去（镜像的椭圆 z 是 -1）", JSON.stringify(mir));
  ok(!("ez" in (arc ?? {})), "默认挤出方向**不带**那一格（少一个字段，不多一个恒等于 1 的）");

  /* MTEXT：原文，不剥 */
  const mt = ent({ type: "MTEXT", layer: "A-文字", insertionPoint: { x: 10, y: 20 }, textHeight: 300,
    text: "{\\fSimSun|b0;会议室}\\P12 人", rotation: 0.5, attachmentPoint: 5, rectWidth: 1200,
    direction: { x: 1, y: 0 } });
  ok(mt && mt.t === "MTEXT" && mt.p[0] === 10 && mt.h === 300 && mt.att === 5 && mt.w === 1200,
     "**MTEXT 单独一档**，带插入点 / 字高 / 对齐 / 参考宽度", JSON.stringify(mt));
  ok(mt && mt.s.includes("\\f") && mt.s.includes("\\P"),
     "**原文一个字都不剥**（格式码还在）—— 剥码和拆行是 Studio 的事，那些规则还会再调", mt.s);
  /* ⚠️ 空文字框是真实存在的，而「空」和「没认出来」不是一回事 */
  const empty = ent({ type: "MTEXT", insertionPoint: { x: 1, y: 2 }, textHeight: 100, text: "" });
  ok(empty && empty.t === "MTEXT" && empty.s === "",
     "**空的 MTEXT 照样吐**（空文字框是真的；报成 unknown 会让用户以为图读坏了）");
  ok(ent({ type: "MTEXT", textHeight: 100, text: "x" }) === null, "没有插入点的 MTEXT 才回 null");

  /* 老那几支不许被这一轮带坏 */
  const at = ent({ type: "ATTRIB", layer: "图框", text: { text: "一层平面布置图", startPoint: { x: 5, y: 6 }, textHeight: 250 } });
  ok(at && at.t === "TEXT" && at.s === "一层平面布置图" && at.p[0] === 5 && at.h === 250,
     "`ATTRIB` 的**嵌套** `text` 照旧取得对（不是 `[object Object]`）", JSON.stringify(at));
  const pl = ent({ type: "POLYLINE2D", layer: "墙", vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }], flag: 1 });
  ok(pl && pl.t === "LWPOLYLINE" && pl.closed === true, "`POLYLINE2D` 照旧认得（曾经吃掉 52 条线）");
  ok(ent({ type: "HATCH", layer: "填充" }) === null, "认不出的类型照旧回 null（计进 `skipped`，按类型分开记）");

  /* ⚠️ **映射只有一处**：块里的实体和顶层走的是同一个 `conv()` → `ent()`。
     这一条钉的不是行为而是结构 —— 哪天有人在 `dwg2json.mjs` 里又写一个 switch，
     块里的椭圆就会和顶层的分叉，而那种分叉在读数上长得像「块里的没认出来」。 */
  const srcText = readFileSync(new URL("../src/dwg2json.mjs", import.meta.url), "utf8");
  ok(!/case "LINE"/.test(srcText) && /from "\.\/ent\.mjs"/.test(srcText),
     "**实体映射只有一处**（`dwg2json.mjs` 里没有第二个 switch，块和顶层共用 `ent()`）");
}

console.log(`\n${bad.length === 0 ? "✓" : "✗"} 契约自测 ${pass}/${pass + bad.length}`);
if (bad.length) { bad.forEach((b) => console.log(`  ✗ ${b}`)); process.exit(1); }
