#!/usr/bin/env node
/** dwg → `raw.ts` 契约的 JSON。**独立程序** —— 这是 GPL 边界（`doc/27` §2.1）。
 *
 *  ⚠️⚠️ 它链 `@mlightcad/libredwg-web`，而 libredwg 是 **GPL-3.0**。
 *  所以它既不 import Studio 的任何东西，Studio 也不 import 它 ——
 *  两边只经**命令行 + 一个 JSON 文件**说话。这个进程边界是整件事的前提。
 *
 *  契约（`server/src/cad/raw.ts`）：
 *    `--version`                        → 打一行版本，退出码 0
 *    `--in <abs.dwg> --out <abs.json>`  → 写 JSON，退出码 0；读不了就非 0 + stderr
 */
import { LibreDwg, Dwg_Error } from "@mlightcad/libredwg-web";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
/* ⚠️ 实体映射搬进 `ent.mjs` 了（0.1.1）：那一段是这个转换器里**唯一有分支的地方**，
   而它的毛病只在真图上露脸（`POLYLINE2D`、`ATTRIB` 的嵌套 text、整个缺掉的 `ELLIPSE`）。
   搬出去之后契约自测能用**自拟数据**喂它，一份 dwg 都不用。
   ⚠️ 这一行是相对 import，`build.mjs` 把两个文件拷到同一层，所以产物里不用改写它。 */
import { ent, num, xy } from "./ent.mjs";

const a = process.argv.slice(2);
if (a.includes("--version")) { console.log("umbra-dwg2json 0.1.1 (libredwg-web 0.8.3, GPL-3.0)"); process.exit(0); }
const inAt = a.indexOf("--in"), outAt = a.indexOf("--out");
if (inAt < 0 || outAt < 0) { console.error("用法：--in <x.dwg> --out <y.json>"); process.exit(2); }

const warnings = [];

/* ── 读文件时的错误码：**自己读，自己分档** ──
   ⚠️⚠️ **这里原来有两段注释，写着「这件事在这个进程里做不到」，而那是错的。**
   原文说：libredwg 把「Open dwg file with error code: N」**直接写 fd 1**，
   劫持 `console.log` 和 `process.stdout.write` 都拦不住，所以只能由调用方去捞 stdout。
   **三条实测把它全推翻了**：
   ① 那一行是 npm 封装层 `lib/libredwg.js` 里一句 `console.warn` 打的，不是 WASM 写的；
   ② 所以它在 **stderr** 上，不在 stdout 上 —— 调用方捞 stdout **一个字都捞不到**；
   ③ 封装层的 `dwg_read_data()` 把 `result.error` **吞掉**只打一行警告，
      而 WASM 的 `dwg_read_file()` 本来就返回 `{ data, error }` —— 绕过封装就拿得到。
   > **「这件事做不到」是整段推理里最该去验的一句，而它当时一次都没被验过。**
   > 一句写进注释的「做不到」，会让下一个人把补救做在错的那一侧。

   分档按 libredwg 自己的分界线（`Dwg_Error`，`< 128` 是可恢复的）：
   · `0`                → 干净读完；
   · `1..127`（CRC 坏、不支持的类、句柄非法…）→ **它恢复过这份文件**：图能看，
     但可能有实体丢了或位置不对 → 进 `stats.warnings`，退出码仍是 0；
   · `>= 128`（找不到段 / 内部错 / INVALIDDWG / IO / 内存）→ **这不是一份读得出来的图**
     → 非 0 退出 + stderr 说为什么。
   ⚠️ 第三档原来是**退出码 0 加一份空 JSON**（实测：喂一串汉字进去，
   `error=2048`、layers/blocks/ents 全 0、退出码 0）。
   > 调用方看到的是「转换成功」，用户看到的是一张空图，**而没有任何地方说过出了事**。
   > **一个看起来成功的回执，比一个失败的回执糟。** */
const FATAL = 128;                         // libredwg 自己的分界线
const ERR_NAMES = Object.entries(Dwg_Error).filter(([, v]) => typeof v === "number");
const decode = (code) => ERR_NAMES.filter(([, v]) => code & v).map(([k]) => k);

/* ⚠️ 自己先看一眼文件在不在 —— 不看的话 `readFileSync` 吐的是 node 的栈，
   而**调用方会把 stderr 原样转给用户**（Studio 的 `raw.ts` 就是这么做的，刻意的：
   改写对端的话等于把「版本太新」说成「出错了」）。
   > 一句原样转述出去的错误信息，写得像不像人话，决定了用户看到的是提示还是栈。 */
const inPath = a[inAt + 1];
if (!inPath) { console.error("用法：--in <x.dwg> --out <y.json>"); process.exit(2); }
if (!existsSync(inPath)) { console.error(`找不到这个文件：${inPath}`); process.exit(2); }

const dwg = await LibreDwg.create();
const buf = readFileSync(inPath);

/* ⚠️ **不走封装的 `dwg_read_data()`** —— 它把 `result.error` 吞掉（见上）。
   `LibreDwg` 是个 Proxy，认不出来的属性直接转给 WASM 实例，所以 `FS` 和
   `dwg_read_file` 都够得着。写进 WASM 的内存文件系统、读、再删掉。
   ⚠️ WASM 里那个文件名固定叫 `tmp.dwg`（封装层用的也是它）—— 它在 WASM 自己的
   内存 FS 里，和盘上无关，不会碰到用户的任何文件。 */
const FS_NAME = "tmp.dwg";
dwg.FS.writeFile(FS_NAME, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
let res;
try { res = dwg.dwg_read_file(FS_NAME); }
finally { if (dwg.FS.analyzePath(FS_NAME, false).exists) dwg.FS.unlink(FS_NAME); }
const code = Number(res?.error ?? 0);
if (code & Dwg_Error.OUTOFMEM) {
  console.error(`这份 dwg 太大，转换器的内存不够（libredwg 错误码 ${code}：${decode(code).join("+")}）`);
  process.exit(4);
}
if (code >= FATAL) {
  if (res?.data) dwg.dwg_abandon(res.data);
  console.error(`这份 dwg 读不出来（libredwg 错误码 ${code}：${decode(code).join("+")}）`
    + " —— 多半是文件损坏、不是 dwg、或者版本比转换器新");
  process.exit(3);
}
const ptr = res?.data;
if (!ptr) { console.error("这份 dwg 读不开（libredwg 没给出任何数据）"); process.exit(3); }
if (code > 0) {
  warnings.push(`转换器恢复了这份文件（libredwg 错误码 ${code}：${decode(code).join("+")}）`
    + " —— 图能看，但可能有实体丢了或位置不对");
}
const ver = dwg.dwg_get_version_type(ptr), cp = dwg.dwg_get_codepage(ptr);
const { database: db, stats } = dwg.convertEx(ptr);

let unknown = 0;
/** ⚠️ **`unknown` 是一个数字，没人会去看它由哪些类型组成。**
 *  4003 这个数会让用户以为图读坏了，而其中 1765 个是标注、860 个是填充 ——
 *  两样我们本来就不需要。按类型分开记，让 Studio 那边能说人话。 */
const skipped = {};
const conv = (list) => {
  const out = [];
  for (const e of list ?? []) {
    const r = ent(e);
    if (r) out.push(r);
    else { unknown++; const t = String(e?.type ?? "?"); skipped[t] = (skipped[t] ?? 0) + 1; }
  }
  return out;
};

const layers = (db.tables?.LAYER?.entries ?? []).map((L) => ({
  name: String(L.name), ...(L.off ? { off: true } : {}), ...(L.frozen ? { frozen: true } : {}),
  ...(Number.isFinite(L.colorIndex) ? { color: L.colorIndex } : {}),
}));

/* ⚠️ `*Model_Space` / `*Paper_Space` 这些是**布局**不是块，排掉 —— 不排的话
   模型空间的实体会在 `blocks` 里再出现一次，统计直接翻倍。 */
const blocks = (db.tables?.BLOCK_RECORD?.entries ?? [])
  .filter((b) => b.name && !/^\*/.test(String(b.name)))
  .map((b) => ({ name: String(b.name), ...(b.basePoint ? { base: xy(b.basePoint) } : {}), ents: conv(b.entities) }))
  .filter((b) => b.ents.length > 0);

const ents = conv(db.entities);

const doc = {
  version: 1,
  dwg: { version: String(ver?.hdr ?? ver?.type ?? "?"), codepage: String(cp) },
  layers, blocks, ents,
  stats: {
    entities: ents.length, unknown: unknown + (stats?.unknownEntityCount ?? 0),
    skipped, ...(warnings.length ? { warnings } : {}),
  },
};
writeFileSync(a[outAt + 1], JSON.stringify(doc));
