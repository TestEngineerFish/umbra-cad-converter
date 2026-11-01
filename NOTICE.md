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

> ⚠️ **这不是法律意见。** 它是我们能从公开材料核到的事实加一条取舍。
> **正式发布前需请懂许可的人确认**，至少三件：
> ① `GPL-3.0-or-later` 这个取法；
> ② 上面那处 npm 元数据不一致要不要去跟封装者确认；
> ③ **见 README「进程边界」一节最后那条** —— 调用方自带的 node 跑这份 GPL 代码，
>    算不算「组合作品」。这一条是整件事里唯一真正有分量的问题，我们不替它下结论。
