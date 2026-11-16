import { Composition } from "remotion";
import { IsEthicalVideo, TOTAL_FRAMES } from "./Video";

export const Root = () => (
  <>
    {/* square: LinkedIn and X feeds */}
    <Composition id="IsEthical" component={IsEthicalVideo} durationInFrames={TOTAL_FRAMES} fps={30} width={1080} height={1080} />
    {/* 16:9: X, YouTube, slides */}
    <Composition id="IsEthicalWide" component={IsEthicalVideo} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
  </>
);
