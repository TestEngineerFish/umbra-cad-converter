/** 一条 libredwg 实体 → `raw.ts` 契约里的一条 `RawEnt`。认不出来回 `null`（计进 `unknown`）。
 *
 *  ## 为什么它从 `dwg2json.mjs` 里搬出来（2026-11-01）
 *
 *  这一段是**整个转换器里唯一有分支的地方**，而它的毛病只在真图上露脸：
 *  `POLYLINE2D` 写成 `POLYLINE` 吃掉 52 条旧式多段线 · `ATTRIB` 的 `text` 是嵌套对象
 *  变成 `[object Object]` · `ELLIPSE` **压根没有这一支**（sam 的图上 19 个全进 unknown）。
 *  搬出来之后它**第一次可以用自拟数据单测** —— 契约自测里喂几个形状像 libredwg 的对象就行，
 *  一份 dwg 都不用。
 *  > **一段只能靠真图才验得到的映射，等于一段没有判据的代码。**
 *
 *  ⚠️ 这个文件**不 import 任何东西**，所以产物里不用改写它的 import ——
 *  `build.mjs` 只是把它拷到 `dwg2json.mjs` 旁边（相对位置不变）。
 *
 *  ## 这一侧刻意「笨」（口径由 geek-99 2026-11-01 定）
 *
 *  **参数原样吐出去，不在这里算。** 椭圆不在这里离散，MTEXT 的格式码不在这里剥 ——
 *  那些规则一定还会再调（每段几度、`%%c` / `\U+` / 堆叠分数…），
 *  而这个仓库是 GPL、单独发版：动它一次就牵动 Studio 的 `PINNED` + CAD 插件里带的那一份 + 重新打包。
 *  > **会反复调的规则，不该住在一个「改一次要发一次版」的地方。**
 */

export const num = (v) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : 0);
export const xy = (p) => (p ? [num(p.x), num(p.y)] : null);

/** 挤出方向是不是默认的 (0,0,1)。不是默认的那一条要带出去（镜像的椭圆 z 是 -1）。 */
const defaultExtrusion = (e) => {
  const z = e?.extrusionDirection;
  if (!z) return true;
  return num(z.x) === 0 && num(z.y) === 0 && num(z.z) === 1;
};

export function ent(e) {
  const l = String(e.layer ?? "0");
  switch (e.type) {
    case "LINE": { const p = xy(e.startPoint), q = xy(e.endPoint); return p && q ? { t: "LINE", l, a: p, b: q } : null; }
    /* ⚠️ **`POLYLINE2D` 是真实的类型名**，不是 `POLYLINE` —— 第一版按后者写，
       52 条旧式多段线被静默扔进 unknown。`unknown` 是个数字，**没人会去看它由哪些类型组成**。 */
    case "LWPOLYLINE": case "POLYLINE": case "POLYLINE2D": {
      const v = (e.vertices ?? []).map(xy).filter(Boolean);
      return v.length >= 2 ? { t: "LWPOLYLINE", l, v, ...(e.closed || (num(e.flag) & 1) ? { closed: true } : {}) } : null;
    }
    case "ARC": { const c = xy(e.center); return c ? { t: "ARC", l, c, r: num(e.radius), a0: num(e.startAngle), a1: num(e.endAngle) } : null; }
    case "CIRCLE": { const c = xy(e.center); return c ? { t: "CIRCLE", l, c, r: num(e.radius) } : null; }
    /* ⚠️⚠️ **ELLIPSE 这一支 0.1.1 才有**（sam 2026-11-01 实测：一张真图上 19 个全进 unknown，
       界面上报「有 21 个实体没认出来」）。圆形家具、椭圆灯具、圆桌都可能是它。
       字段名取自 libredwg-web 0.8.3 自己的类型声明（`DwgEllipseEntity`）：
       · `center` 中心 · `majorAxisEndPoint` **相对中心**的长轴端点（是向量，不是绝对点）
       · `axisRatio` 短轴 / 长轴 · `startAngle` / `endAngle` **参数**（整椭圆是 0 → 2π）
       ⚠️ 「起止参数」不是几何角度：椭圆上参数 t 处的点是
       `c + 长轴向量·cos t + 短轴向量·sin t`。**这件事由 Studio 那边离散**，这里只吐参数。 */
    case "ELLIPSE": {
      const c = xy(e.center), ma = xy(e.majorAxisEndPoint ?? e.majorAxis ?? e.majorAxisVector);
      if (!c || !ma) return null;
      const ratio = num(e.axisRatio ?? e.minorToMajorRatio);
      /* 轴比为 0 的椭圆退化成一条线段 —— 吐出去也没用，而且后面除它会出 NaN */
      if (!(ratio > 0) || (ma[0] === 0 && ma[1] === 0)) return null;
      const a0 = num(e.startAngle), a1 = num(e.endAngle);
      return { t: "ELLIPSE", l, c, ma, ratio, a0, a1,
        ...(defaultExtrusion(e) ? {} : { ez: num(e.extrusionDirection.z) < 0 ? -1 : 1 }) };
    }
    /* ⚠️ `ATTRIB` / `ATTDEF` 是**块属性里的文字** —— 图框标题栏的图名经常是这个而不是 TEXT。
       当成文字收进来，不然「这张图叫什么」在某些图纸上永远取不到。 */
    case "TEXT": case "ATTRIB": case "ATTDEF": {
      const p = xy(e.startPoint ?? e.insertionPoint ?? e.position ?? (e.text && typeof e.text === "object" ? e.text.startPoint : null));
      /* ⚠️ `ATTRIB` 的 `text` 是一个**嵌套对象** `{text, startPoint, textHeight, …}`，不是字符串。
         `String(对象)` 会得到 `[object Object]` —— 一个**看起来有内容**的假文字。 */
      const inner = e.text && typeof e.text === "object" ? e.text : null;
      const s = String((inner ? inner.text : e.text) ?? e.value ?? "").trim();
      const p2 = p ?? (inner ? xy(inner.startPoint ?? inner.insertionPoint) : null);
      return p2 && s ? { t: "TEXT", l, p: p2, h: num(e.textHeight ?? e.height ?? (inner ? inner.textHeight : 0)) || 200, s,
        ...(e.rotation ? { rot: num(e.rotation) } : {}) } : null;
    }
    /* ⚠️⚠️ **MTEXT 0.1.1 起单独一档，而且吐的是原文**（口径 geek-99 2026-11-01）。
       0.1.0 把它压成**一条已经剥过格式码的 TEXT**，于是：
       · `\P` 换行的多行文字在这一步就被压成一行，**拆不出来了**；
       · 剥码规则住在这个仓库里 —— 改一次就要发一次版。
       现在原文照吐，剥码和拆行由 Studio 做。
       ⚠️ **`s` 不 `trim()`、不剥** —— 剥了就不是原文；空串也照吐（**空文字框是真实存在的**，
       而「空」和「没认出来」不是一回事：报成 unknown 会让用户以为图读坏了）。
       字段名取自 `DwgMTextEntity`：`insertionPoint` · `textHeight` · `text` ·
       `rotation` · `attachmentPoint`（1..9）· `direction`（X 轴向量）· `rectWidth`。 */
    case "MTEXT": {
      const p = xy(e.insertionPoint ?? e.startPoint ?? e.position);
      if (!p) return null;
      const s = typeof e.text === "string" ? e.text : String(e.text && typeof e.text === "object" ? (e.text.text ?? "") : (e.text ?? ""));
      const dir = e.direction ? xy(e.direction) : null;
      return { t: "MTEXT", l, p, h: num(e.textHeight ?? e.height) || 200, s,
        ...(e.rotation ? { rot: num(e.rotation) } : {}),
        ...(Number.isFinite(e.attachmentPoint) && e.attachmentPoint ? { att: num(e.attachmentPoint) } : {}),
        ...(dir && (dir[0] !== 0 || dir[1] !== 0) ? { dir } : {}),
        ...(num(e.rectWidth) > 0 ? { w: num(e.rectWidth) } : {}) };
    }
    case "INSERT": {
      const p = xy(e.insertionPoint ?? e.position);
      if (!p || !e.name) return null;
      const sx = num(e.xScale ?? e.scale?.x ?? 1) || 1, sy = num(e.yScale ?? e.scale?.y ?? 1) || 1;
      return { t: "INSERT", l, n: String(e.name), p,
        ...(sx !== 1 || sy !== 1 ? { s: [sx, sy] } : {}),
        ...(e.rotation ? { rot: num(e.rotation) } : {}) };
    }
    default: return null;
  }
}
