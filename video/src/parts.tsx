// Shared building blocks: backdrop, wordmark, Homer with the scales, question card, bars, cursor, icons.
import React from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, F, MONO } from "./theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

/** Spring that starts at `delay` frames. */
export const useIn = (delay = 0, config: Record<string, number | boolean> = { damping: 18, stiffness: 160 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config });
};

/** Soft glow + slowly drifting "?" and ἦθος glyphs behind every scene. */
export const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const glyphs = ["?", "ἦθος", "?", "yes", "?", "no", "?", "ἦθος", "?"];
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 85% 8%, ${C.brandSoft}, transparent 45%), radial-gradient(circle at 8% 95%, ${C.goldSoft}, transparent 42%)` }} />
      {glyphs.map((g, i) => {
        const x = random(`x${i}`) * width;
        const y = ((random(`y${i}`) * height - f * (0.5 + random(`s${i}`) * 0.7)) % (height + 200) + height + 200) % (height + 200) - 100;
        const greek = g === "ἦθος";
        return (
          <div key={i} style={{
            position: "absolute", left: x, top: y, fontFamily: greek ? F.greek : F.ui, fontWeight: 900,
            fontSize: (greek ? 60 : 110) + random(`z${i}`) * 70, color: i % 3 === 0 ? C.gold : C.brand, opacity: 0.07,
            transform: `rotate(${(random(`r${i}`) - 0.5) * 30 + f * 0.15}deg)`,
          }}>{g}</div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Wordmark: React.FC<{ size?: number }> = ({ size = 44 }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: size * 0.3, whiteSpace: "nowrap" }}>
    <span style={{ fontFamily: F.west, fontSize: size, color: C.brand }}>Is it ethical?</span>
    <span style={{ fontFamily: F.greek, fontSize: size * 0.72, color: C.muted }}>ἦθος</span>
  </div>
);

/** Homer the armadillo holding the scales (same drawing as the site). `tilt` in degrees. */
export const Homer: React.FC<{ size: number; tilt?: number; cheer?: number }> = ({ size, tilt = 0, cheer = 0 }) => {
  const leaves = [...Array(7)].map((_, i) => {
    const t = ((190 + i * 24) * Math.PI) / 180;
    const x = 98 + 15 * Math.cos(t), y = 58 + 11 * Math.sin(t);
    return <ellipse key={i} cx={x} cy={y} rx={2.6} ry={5} fill={C.olive} transform={`rotate(${(t * 180) / Math.PI + 90} ${x} ${y})`} />;
  });
  return (
    <svg width={size} height={(size * 112) / 124} viewBox="0 0 124 112" style={{ overflow: "visible" }}>
      <ellipse cx="60" cy="104" rx="42" ry="5" fill={C.line} />
      <path d="M22 88q-14 6-17-6" stroke={C.skin} strokeWidth={6} strokeLinecap="round" fill="none" />
      <ellipse cx="34" cy="95" rx="8" ry="7" fill={C.skin} />
      <ellipse cx="84" cy="95" rx="8" ry="7" fill={C.skin} />
      <path d="M18 92q2-52 44-54 40 2 42 54z" fill={C.shell} />
      <path d="M40 47q-5 22-2 45M53 41q-2 25 0 51M66 40v52M79 43q3 24 1 49M91 52q4 20 2 40" stroke={C.band} strokeWidth={3} fill="none" strokeLinecap="round" />
      <g transform={`translate(0 ${-6 * cheer})`}>
        <g stroke={C.goldDeep} strokeWidth={2.4} strokeLinecap="round" fill="none">
          <path d="M84 72q2-16 2-40" />
          <g transform={`rotate(${tilt} 86 30)`}>
            <path d="M68 30h36" />
            <path d="M68 30l-6 12h12zM104 30l-6 12h12z" fill={C.goldSoft} />
          </g>
        </g>
        <circle cx="86" cy="29" r="3" fill={C.gold} />
        <path d="M84 74q-2-6 2-10" stroke={C.skin} strokeWidth={7} strokeLinecap="round" fill="none" />
      </g>
      <path d="M92 60q22 0 28 18-8 8-24 6z" fill={C.skin} />
      <ellipse cx="94" cy="54" rx="5" ry="9" fill={C.skin} transform="rotate(-25 94 54)" />
      {leaves}
      <circle cx="103" cy="68" r="2.8" fill={C.mink} />
      <circle cx="104" cy="67" r=".9" fill="#fff" />
      <path d="M105 77q5 4 10 0" stroke={C.mink} strokeWidth={2} fill="none" strokeLinecap="round" />
    </svg>
  );
};

export const PersonIcon: React.FC<{ size: number; color?: string }> = ({ size, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z" /></svg>
);
export const BotIcon: React.FC<{ size: number; color?: string }> = ({ size, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="8" width="16" height="12" rx="4" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5" /><circle cx="12" cy="3.5" r="1.2" fill={color} />
  </svg>
);
export const UpIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 4l8 9h-5v7H9v-7H4z" /></svg>
);

/** Step label at the top of each scene, e.g. "1 · Vote blind". */
export const Step: React.FC<{ n: number; text: string; delay?: number }> = ({ n, text, delay = 0 }) => {
  const s = useIn(delay);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
      <div style={{ width: 54, height: 54, borderRadius: 16, background: C.brand, color: "#fff", display: "grid", placeItems: "center", fontFamily: F.ui, fontWeight: 900, fontSize: 30, boxShadow: `0 5px 0 ${C.brandDeep}` }}>{n}</div>
      <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 46, color: C.ink, letterSpacing: "-0.01em" }}>{text}</div>
    </div>
  );
};

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.surface, border: `2px solid ${C.line}`, borderRadius: 30, padding: 34, boxShadow: "0 18px 50px rgba(22,26,58,.10)", display: "flex", flexDirection: "column", gap: 22, ...style }}>{children}</div>
);

export const Tag: React.FC<{ v: "yes" | "no" | "unsure" }> = ({ v }) => {
  const bg = { yes: C.oliveSoft, no: C.claySoft, unsure: C.surface2 }[v];
  const fg = { yes: C.oliveDeep, no: C.clayDeep, unsure: C.muted }[v];
  return <span style={{ background: bg, color: fg, fontFamily: F.ui, fontWeight: 900, fontSize: 20, padding: "3px 12px", borderRadius: 999, textTransform: "uppercase", letterSpacing: "0.05em" }}>{v}</span>;
};

export const AgentChip: React.FC<{ model: string; harness?: string; size?: number }> = ({ model, harness, size = 24 }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.brandSoft, color: C.brand, padding: "4px 14px 4px 10px", borderRadius: 999, fontFamily: F.ui, fontWeight: 800, fontSize: size }}>
    <BotIcon size={size * 1.05} />{model}{harness ? <span style={{ opacity: 0.75, fontWeight: 700 }}>· {harness}</span> : null}
  </span>
);
export const HumanChip: React.FC<{ name: string; size?: number }> = ({ name, size = 24 }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.ink, fontFamily: F.ui, fontWeight: 800, fontSize: size }}><PersonIcon size={size} />{name}</span>
);

/** Big chunky Yes/No buttons. `pressed` 0..1 pushes the yes button down. */
export const YesNo: React.FC<{ pressed?: number; height?: number }> = ({ pressed = 0, height = 96 }) => {
  const btn = (label: string, bg: string, deep: string, p: number): React.ReactNode => (
    <div style={{
      height, borderRadius: 22, background: bg, color: "#fff", display: "grid", placeItems: "center", fontFamily: F.ui, fontWeight: 900,
      fontSize: height * 0.36, letterSpacing: "0.06em", boxShadow: `0 ${7 - 6 * p}px 0 ${deep}`, transform: `translateY(${6 * p}px)`,
    }}>{label}</div>
  );
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>{btn("YES", C.olive, C.oliveDeep, pressed)}{btn("NO", C.clay, C.clayDeep, 0)}</div>;
};

/** Yes/no bar that grows from the middle split. No numbers: the video uses example data. */
export const Bar: React.FC<{ yes: number; grow: number; height?: number; label?: React.ReactNode }> = ({ yes, grow, height = 40, label }) => {
  const y = 0.5 + (yes - 0.5) * grow;
  return (
    <div style={{ display: "grid", gridTemplateColumns: label ? "190px 1fr" : "1fr", alignItems: "center", gap: 16 }}>
      {label ? <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 26, color: C.muted, display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>{label}</div> : null}
      <div style={{ height, borderRadius: height * 0.32, overflow: "hidden", display: "flex", background: C.surface2, opacity: 0.25 + 0.75 * Math.min(1, grow * 1.5) }}>
        <div style={{ width: `${y * 100}%`, background: C.olive }} />
        <div style={{ flex: 1, background: C.clay }} />
      </div>
    </div>
  );
};

/** A mouse pointer gliding from `from` to `to` between frames a and b, clicking at `click`. */
export const Cursor: React.FC<{ from: [number, number]; to: [number, number]; a: number; b: number; click: number }> = ({ from, to, a, b, click }) => {
  const f = useCurrentFrame();
  const t = interpolate(f, [a, b], [0, 1], { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) });
  const x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t;
  const press = interpolate(f, [click - 3, click, click + 5], [1, 0.82, 1], clamp);
  const ring = interpolate(f, [click, click + 16], [0, 1], clamp);
  const show = interpolate(f, [a - 8, a, click + 6, click + 14], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: show, pointerEvents: "none" }}>
      {f >= click ? <div style={{ position: "absolute", left: -40 * ring, top: -40 * ring, width: 80 * ring, height: 80 * ring, borderRadius: "50%", border: `4px solid ${C.olive}`, opacity: 1 - ring }} /> : null}
      <svg width={46} height={46} viewBox="0 0 24 24" style={{ transform: `scale(${press})`, transformOrigin: "0 0", filter: "drop-shadow(0 4px 6px rgba(0,0,0,.25))" }}>
        <path d="M3 2l17 9-7.5 1.8L9 20z" fill="#161a3a" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/** Small "example data" note so the demo never passes for real results. */
export const ExampleNote: React.FC = () => (
  <span style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 18, color: C.muted, border: `2px dashed ${C.line}`, borderRadius: 999, padding: "2px 12px" }}>example data</span>
);

export const mono = MONO;
