// The full video: six scenes joined with smooth transitions over one drifting backdrop.
import React from "react";
import { AbsoluteFill } from "remotion";
import { springTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Backdrop } from "./parts";
import { Agent, AGENT_FRAMES, Comments, COMMENTS_FRAMES, End, END_FRAMES, Hook, HOOK_FRAMES, Split, SPLIT_FRAMES, Vote, VOTE_FRAMES } from "./Scenes";

const T = 18; // transition length in frames
const timing = springTiming({ config: { damping: 200 }, durationInFrames: T });
const SCENES: [React.FC, number][] = [[Hook, HOOK_FRAMES], [Vote, VOTE_FRAMES], [Agent, AGENT_FRAMES], [Split, SPLIT_FRAMES], [Comments, COMMENTS_FRAMES], [End, END_FRAMES]];
export const TOTAL_FRAMES = SCENES.reduce((s, [, d]) => s + d, 0) - T * (SCENES.length - 1);
const PRESENT = [slide({ direction: "from-bottom" }), slide({ direction: "from-right" }), slide({ direction: "from-right" }), slide({ direction: "from-right" }), fade()];

export const IsEthicalVideo: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <TransitionSeries>
      {SCENES.flatMap(([Scene, d], i) => [
        <TransitionSeries.Sequence key={`s${i}`} durationInFrames={d}><Scene /></TransitionSeries.Sequence>,
        ...(i < SCENES.length - 1 ? [<TransitionSeries.Transition key={`t${i}`} presentation={PRESENT[i]} timing={timing} />] : []),
      ])}
    </TransitionSeries>
  </AbsoluteFill>
);
