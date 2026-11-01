# umbra-cad-converter

把 **dwg 读成 JSON** 的一个小程序。给长尾雀 Studio
的 CAD 链路当**可选组件**用：Studio 自己不带它，要看 dwg 的时候按需下载。

**许可：GPL-3.0-or-later**（`LICENSE`）。为什么是 GPL 见 `NOTICE.md`。

---

## 为什么它是一个单独的仓库、单独的进程

能读 dwg 的只有 **GNU LibreDWG**，而它是 GPL。
Studio 不是 GPL，所以这件事只有一个干净的做法：**让它们是两个程序**。

### 进程边界

```
Studio 进程                      这个程序（另一个进程）
───────────                      ──────────────────────
                  --in / --out
cad_open  ────────────────────▶  读 dwg
                                 写一个 JSON 文件
          ◀────────────────────  退出
读那个 JSON
```

说全了就是四条：

1. **两个操作系统进程。** Studio `execFile` 它，等它退出。
2. **只经命令行参数 + 一个 JSON 文件说话。** 没有共享内存、没有动态库、没有 FFI、
   没有 socket、没有插件接口。
3. **Studio 不 import 这里的任何东西**，这里也不 import Studio 的任何东西。
   这个仓库的 `package.json` 里没有 Studio，Studio 的 `package.json` 里没有这个仓库。
4. **这个程序能独立使用。** 它的输入是一份 dwg，输出是一份 JSON，
   命令行就是全部接口 —— 不装 Studio 也用得上（见下面「直接用」）。

> ⚠️ **有一条我们没有能力下结论，写在这里不藏着**：Studio 下载这份代码之后，
> 是**用它自己带的 node 解释器**去跑的（它是一个 Electron 应用，里面有 node）。
> 「分发一个解释器 + 运行期取来一份 GPL 脚本」这件事算不算 GPL 意义上的「组合作品」，
> **需要懂许可的人来判**。我们给出的事实是：解释器是通用的（node 跑任何 JS）、
> 脚本是运行期由用户触发下载的、两者各自可独立分发。
> **正式发布前必须有人确认这一条**（`NOTICE.md` 末尾列了三条待确认的）。

---

## 契约

```
dwg2json --version                          → stdout 一行版本，退出码 0
dwg2json --in <abs.dwg> --out <abs.json>    → 写 JSON，退出码 0
                                              读不了：非 0 退出码 + stderr 说为什么
```

出的 JSON 形状（完整定义在 Studio 的 `server/src/cad/raw.ts`，那一份是正本）：

```jsonc
{
  "version": 1,
  "dwg":    { "version": "AC1032", "codepage": "936" },
  "layers": [{ "name": "…", "off": true, "frozen": true, "color": 7 }],
  "blocks": [{ "name": "…", "base": [x, y], "ents": [ /* 同下 */ ] }],
  "ents":   [ /* 模型空间顶层；块里的东西在 blocks 里，这里只有 INSERT */ ],
  "stats":  { "entities": 0, "unknown": 0, "skipped": { "DIMENSION": 0 } }
}
```

图元六种，**紧凑形式**（一张图有上万条，字段名比数值本身还贵）：

| `t` | 字段 |
| --- | --- |
| `LINE` | `l` 图层 · `a` `b` 两端 |
| `LWPOLYLINE` | `l` · `v` 顶点数组 · `closed?` |
| `ARC` | `l` · `c` 圆心 · `r` · `a0` `a1` 起止角 |
| `CIRCLE` | `l` · `c` · `r` |
| `TEXT` | `l` · `p` · `h` 字高 · `s` 文字 · `rot?` |
| `INSERT` | `l` · `n` 块名 · `p` · `s?` 缩放 · `rot?` |

### 三条实现上踩出来的，留在这儿免得下一个人再踩

- **`POLYLINE2D` 是真实的类型名**，不是 `POLYLINE`。只认后者的话旧式多段线会被静默
  扔进 `unknown`，而 `unknown` 是一个数字，**没人会去看它由哪些类型组成**。
- **`ATTRIB` 的 `text` 是一个嵌套对象**（`{text, startPoint, …}`），不是字符串。
  `String(对象)` 得到 `[object Object]` —— 一个**看起来有内容**的假文字。
- **错误码要自己读，别让封装层吞掉。** npm 封装层的 `dwg_read_data()` 把
  `result.error` 变成一句 `console.warn('Open dwg file with error code:', N)` 就返回了，
  于是：**读一份根本不是 dwg 的文件也会退出码 0 并写出一份空 JSON**
  （实测：喂一串汉字 → `error=2048 INVALIDDWG`，layers/blocks/ents 全 0，退出码 **0**）。
  > **一个看起来成功的回执，比一个失败的回执糟。**
  绕过封装直接用 WASM 的 `dwg_read_file()`（它返回 `{ data, error }`），
  按 libredwg 自己的分界线分档：`< 128` 是「它恢复过这份文件」→ 进 `stats.warnings`、
  退出码 0；`>= 128` → 非 0 退出 + stderr 说清是哪几个标志位。
  ⚠️ **这里原来写着「这一行在这个进程里拦不住，WASM 直接写 fd 1」—— 那句话是错的。**
  它是封装层 JS 里的 `console.warn`，所以在 **stderr** 上；调用方去捞 **stdout**
  一个字都捞不到。
  > 「这件事做不到」是整段推理里最该去验的一句，而它当时一次都没被验过。

---

## 直接用（不装 Studio）

```bash
npm ci
node src/dwg2json.mjs --in /abs/path/图.dwg --out /tmp/out.json
```

## 构建 Release 产物

```bash
npm ci
npm run build        # → dist/dwg2json-<版本>.tar.gz 和它的 .sha256
```

产物里是：`dwg2json.mjs`（把 import 改成相对路径的那一份）、
`vendor/libredwg-web/`（原样 vendor，去掉 `.map` 与 `.d.ts`）、`LICENSE`、`NOTICE.md`、`VERSION`。
约 **11 MB**，解包后 **不含 `node_modules`**。

**它是平台无关的** —— 纯 JS + 一份 wasm，谁的 node 都能跑（要 node ≥ 20）。
所以产物名里**没有** `macos-arm64`：它跑在哪都一样。
⚠️ 但**只在 macOS arm64 上实测过**，别把「只测过一个平台」读成「只能用在一个平台」。

构建脚本最后会扫一遍产物：**有 `.dwg` / `.dxf` 或者本机绝对路径就直接失败**。
「别忘了删掉测试用的图」是一件需要人记得的事，而需要人记得的事会被忘掉。

## 自测

```bash
npm run selftest
```

⚠️ **这个仓库里一份 dwg 夹具都没有，而那不是漏了** —— 见 `fixtures/README.md`。

## 发一版

1. 改 `package.json` 的 `version`
2. `npm ci && npm run selftest && npm run build`
3. 把 `dist/dwg2json-<版本>.tar.gz` 和 `.sha256` 传成 tag `v<版本>` 的 Release 资产
4. **把那个 sha256 写进 Studio 的 `server/src/cad/install.ts`** ——
   Studio 的校验值写死在代码里，**不从网络上读**。漏了这一步的症状是
   「下载完说校验不过」，而不是「装上了一个不对的东西」。
