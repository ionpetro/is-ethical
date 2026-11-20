// Link-preview image (1200x630 PNG) for one question: wordmark, category, the question, YES / NO buttons.
// Never shows results (blind voting). Rendered with satori (layout -> SVG) and resvg (SVG -> PNG).
import { readFile } from "node:fs/promises";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { CATEGORIES } from "./core.js";

const W = 1200, H = 630;
const C = {
  bg: "#f6f6f2", ink: "#161a3a", muted: "#5d6286", brand: "#3446c9",
  gold: "#a87402", goldSoft: "#fbefd0", line: "#e0e2ec",
  olive: "#4b8a2a", oliveDeep: "#356a1b", clay: "#c2412d", clayDeep: "#932c1c",
};

let fontsPromise = null;
/** Fonts ship in fonts/ (Vercel bundles them via includeFiles in vercel.json). */
const fonts = () => (fontsPromise ||= Promise.all([
  ["Nunito", 700, "Nunito-wght-700.ttf"], ["Nunito", 800, "Nunito-wght-800.ttf"],
  ["Nunito", 900, "Nunito-wght-900.ttf"], ["Rye", 400, "Rye.ttf"],
].map(async ([name, weight, file]) => ({
  name, weight, style: "normal", data: await readFile(new URL(`../fonts/${file}`, import.meta.url)),
}))).catch((e) => { fontsPromise = null; throw e; }));

/** Tiny element helper in satori's object form (no JSX). */
const h = (style, children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });

/** Font size that keeps the question to about four lines. */
export function titleSize(title) {
  const n = title.length;
  return n <= 50 ? 72 : n <= 80 ? 62 : n <= 110 ? 54 : n <= 150 ? 46 : 40;
}

const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

const button = (label, bg, deep) => h({
  width: 230, height: 84, borderRadius: 20, background: bg, borderBottom: `8px solid ${deep}`,
  alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 34, fontWeight: 900, letterSpacing: 3,
}, label);

/** The layout tree for one question. Exported for tests. @param {{title:string, category:string}} q */
export function ogTree(q) {
  const title = clip(q.title, 180);
  const cat = (CATEGORIES.find((c) => c.id === q.category) || { label: "Other" }).label.toUpperCase();
  return h({
    width: W, height: H, boxSizing: "border-box", flexDirection: "column", justifyContent: "space-between", padding: "52px 64px",
    fontFamily: "Nunito", color: C.ink,
    backgroundColor: C.bg,
    backgroundImage: "radial-gradient(circle at 0% 100%, #fbefd0 0%, rgba(246,246,242,0) 45%), radial-gradient(circle at 100% 0%, #e3e7fb 0%, rgba(246,246,242,0) 50%)",
  }, [
    h({ justifyContent: "space-between", alignItems: "center" }, [
      h({ fontFamily: "Rye", fontSize: 44, color: C.brand }, "Is it ethical?"),
      h({ fontSize: 28, fontWeight: 800 }, [h({ color: C.brand }, "is-ethical"), h({ color: C.ink }, ".tryskepsis.com")]),
    ]),
    h({ flexDirection: "column", gap: 22 }, [
      h({}, [h({ background: C.goldSoft, color: C.gold, fontSize: 24, fontWeight: 900, letterSpacing: 2, padding: "8px 20px", borderRadius: 999 }, cat)]),
      h({ fontSize: titleSize(title), fontWeight: 900, lineHeight: 1.12, letterSpacing: -0.5, maxWidth: 1072 }, title),
    ]),
    h({ alignItems: "center", gap: 24 }, [
      button("YES", C.olive, C.oliveDeep),
      button("NO", C.clay, C.clayDeep),
      h({ flexDirection: "column", marginLeft: 16, fontSize: 26, fontWeight: 700, color: C.muted, lineHeight: 1.3 }, [
        h({}, "Vote, then see how humans"),
        h({}, "and AI agents answered."),
      ]),
    ]),
  ]);
}

/** PNG bytes for one question. @param {{title:string, category:string}} q @returns {Promise<Buffer>} */
export async function ogPng(q) {
  const svg = await satori(ogTree(q), { width: W, height: H, fonts: await fonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}
