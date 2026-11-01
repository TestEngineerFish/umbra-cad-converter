# 第三方代码与许可

这个程序是 **GPL-3.0-or-later**，因为它链接了 LibreDWG。

| 东西 | 来自 | 许可 |
| --- | --- | --- |
| `vendor/libredwg-web/` | [`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web) 0.8.3（npm 包，原样 vendor） | 它的 `package.json` 写 `GPL-3.0` |
| 它里面的 `*.wasm` | [GNU LibreDWG](https://www.gnu.org/software/libredwg/) 编译出来的 WebAssembly | **GPL-3.0-or-later** |
| `src/dwg2json.mjs` | 本仓库 | GPL-3.0-or-later |

## ⚠️ 两处许可标注不一致，照实记下来

**上游 GNU LibreDWG 是 GPL-3.0-**or-later**。** 它的源码头是标准那段
「either version 3 of the License, or (at your option) any later version」，
GNU 项目页和各发行版的打包元数据（例如 openSUSE 的 spec）写的都是 `GPL-3.0-or-later`。

**而 npm 包 `@mlightcad/libredwg-web@0.8.3` 的 `package.json` 里写的是 `"license": "GPL-3.0"`**
（没有 `-or-later`），而且**这个 npm 包里一个 LICENSE 文件都没有**（`files` 字段只列了
`dist` / `lib` / `wasm` / `README.md` / `package.json`）。

本仓库取 **`GPL-3.0-or-later`**，理由两条：

1. **上游的许可不会因为下游的元数据而变窄。** LibreDWG 给出的是 or-later，
   封装者无权把它收窄成 only。
2. **这个选择在两种解读下都成立。** 万一封装者的本意真是 GPL-3.0-only，
   把我们自己写的那部分放成 or-later **仍然可以**与 only 的代码组合分发
   （or-later 是对接收者更宽的一头）；反过来则不成立。

## 对应源码（GPL-3.0 第 6 条）

Release 包里的 `vendor/libredwg-web/wasm/*.wasm` 是**编译产物**。按 GPL-3.0 第 6 条，
分发它要同时提供生成它的**对应源码**。它来自：

| | |
| --- | --- |
| 仓库 | https://github.com/mlightcad/libredwg-web（GNU LibreDWG 的分支，带 wasm 绑定） |
| 版本 | 标签 `v0.8.3`，提交 `b5177613f2c735858a6d1cb1d1c7e238c397b88f`（npm 包 `@mlightcad/libredwg-web@0.8.3` 由它构建） |
| 子模块 | `jsmn` @ `85695f3d5903b1cd5b4030efe50db3b4f5f3c928` |
| wasm 怎么编的 | 那份源码里的 `bindings/javascript/script/build-wasm.mjs` |

**我们不依赖第三方一直留着它**：每个 Release 都附一份
`libredwg-web-0.8.3-source.tar.gz`（上面那个提交 + 子模块的完整源码，`git archive` 打的），
和二进制包放在一起。本仓库自己的源码就是这个仓库本身，构建脚本是 `scripts/build.mjs`（可复现）。

## 「组合作品」那一条的结论

原来这里列了三条待确认。结论如下（依据是 GPL-3.0 原文与 FSF 的 GPL FAQ；**这不是律师意见**）：

1. **取 `GPL-3.0-or-later`**：成立。上游 LibreDWG 是 or-later，见上一节。
2. **npm 元数据写 `GPL-3.0`**：不影响本仓库，不需要去跟封装者确认。
3. **调用方用自带的 node 跑这份程序，不构成组合作品**：
   - 两边是**两个进程**，只经命令行参数和一个 JSON 文件通信，没有链接、共享内存、FFI。
     FSF FAQ 把这种「保持距离」的通信视为两个独立程序。
   - 解释器跑一份程序，被跑的程序对解释器只是数据：GPL 管这份程序，不延伸到解释器
     （node 本身是 MIT）。
   - 这份程序由用户触发、单独下载，不随调用方一起分发。

   所以调用方（长尾雀 Studio）不因为运行它而受 GPL 约束；而**这份程序本身**照 GPL 分发 ——
   带许可文本、带对应源码、谁都能改了再用（`UMBRA_CAD_CONVERTER` 可以指向自己改的版本）。
