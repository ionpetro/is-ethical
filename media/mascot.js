// Copied from public/app.js so the social images use the same Homer.
function mascot(mood = "happy") {
    const eye = mood === "sad" ? '<path d="M100 69q3-3 6 0" stroke="var(--m-ink)" stroke-width="2.4" fill="none" stroke-linecap="round"/>' : '<circle cx="103" cy="68" r="2.8" fill="var(--m-ink)"/><circle cx="104" cy="67" r=".9" fill="#fff"/>';
    const mouth = mood === "sad" ? '<path d="M106 80q4-3 8 0" stroke="var(--m-ink)" stroke-width="2" fill="none" stroke-linecap="round"/>' : '<path d="M105 77q5 4 10 0" stroke="var(--m-ink)" stroke-width="2" fill="none" stroke-linecap="round"/>';
    const tilt = mood === "cheer" ? -8 : mood === "sad" ? 8 : 0;
    const leaves = [...Array(7)].map((_, i) => {
      const t = (190 + i * 24) * Math.PI / 180;
      const x = 98 + 15 * Math.cos(t), y = 58 + 11 * Math.sin(t);
      return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.6" ry="5" fill="var(--olive)" transform="rotate(${(t * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }).join("");
    return `<svg class="mascot" viewBox="0 0 124 112" role="img" aria-label="Homer the armadillo holding the scales">
      <ellipse cx="60" cy="104" rx="42" ry="5" fill="var(--line)"/>
      <path d="M22 88q-14 6-17-6" stroke="var(--m-skin)" stroke-width="6" stroke-linecap="round" fill="none"/>
      <ellipse cx="34" cy="95" rx="8" ry="7" fill="var(--m-skin)"/><ellipse cx="84" cy="95" rx="8" ry="7" fill="var(--m-skin)"/>
      <path d="M18 92q2-52 44-54 40 2 42 54z" fill="var(--m-shell)"/>
      <path d="M40 47q-5 22-2 45M53 41q-2 25 0 51M66 40v52M79 43q3 24 1 49M91 52q4 20 2 40" stroke="var(--m-band)" stroke-width="3" fill="none" stroke-linecap="round"/>
      <g stroke="var(--gold-deep)" stroke-width="2.4" stroke-linecap="round" fill="none">
        <path d="M84 72q2-16 2-40"/>
        <g transform="rotate(${tilt} 86 30)"><path d="M68 30h36"/><path d="M68 30l-6 12h12zM104 30l-6 12h12z" fill="var(--gold-soft)"/></g>
      </g>
      <circle cx="86" cy="29" r="3" fill="var(--gold)"/>
      <path d="M84 74q-2-6 2-10" stroke="var(--m-skin)" stroke-width="7" stroke-linecap="round" fill="none"/>
      <path d="M92 60q22 0 28 18-8 8-24 6z" fill="var(--m-skin)"/>
      <ellipse cx="94" cy="54" rx="5" ry="9" fill="var(--m-skin)" transform="rotate(-25 94 54)"/>
      ${leaves}${eye}${mouth}
    </svg>`;
  }