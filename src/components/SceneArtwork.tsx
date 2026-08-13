import type { CSSProperties, ReactNode } from "react";
import domeUrl from "../../affinity/dome.svg?no-inline";
import plateUrl from "../../affinity/Plate.png";
import plateRimUrl from "../../affinity/Plate_rim.png";
import tableUrl from "../../affinity/Table.png";
import tableRunnerUrl from "../../affinity/Table_runner.png";

interface MovingArtworkProps {
  dragX?: number;
  hidden?: boolean;
}

function motionStyle(dragX = 0) {
  return { "--scene-drag-x": `${dragX}px` } as CSSProperties;
}

function Artwork({
  source,
  fragment,
  className,
  children,
  style,
}: {
  source: string;
  fragment: string;
  className: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={`scene-artwork ${className}`}
      style={style}
      viewBox="0 0 2000 2000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {children ?? <use href={`${source}#${fragment}`} />}
    </svg>
  );
}

function ImageArtwork({
  source,
  className,
  style,
}: {
  source: string;
  className: string;
  style?: CSSProperties;
}) {
  return (
    <img
      className={`scene-artwork ${className}`}
      src={source}
      style={style}
      alt=""
      draggable={false}
      aria-hidden="true"
    />
  );
}

function MaskArtwork({
  source,
  className,
  style,
}: {
  source: string;
  className: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`scene-artwork scene-artwork--mask ${className}`}
      style={{
        ...style,
        maskImage: `url(${source})`,
        WebkitMaskImage: `url(${source})`,
      }}
      aria-hidden="true"
    />
  );
}

export function SceneTableArtwork() {
  return (
    <>
      <MaskArtwork source={tableRunnerUrl} className="scene-artwork--table-runner" />
      <ImageArtwork source={tableUrl} className="scene-artwork--table" />
    </>
  );
}

export function ScenePlateArtwork({ dragX = 0, hidden = false }: MovingArtworkProps) {
  return (
    <>
      <ImageArtwork
        source={plateUrl}
        className={`scene-artwork--plate${hidden ? " is-hidden" : ""}`}
        style={motionStyle(dragX)}
      />
      <MaskArtwork
        source={plateRimUrl}
        className={`scene-artwork--plate-rim${hidden ? " is-hidden" : ""}`}
        style={motionStyle(dragX)}
      />
    </>
  );
}

export function SceneDomeArtwork({ dragX = 0 }: MovingArtworkProps) {
  return (
    <Artwork source={domeUrl} fragment="dome" className="scene-artwork--dome" style={motionStyle(dragX)}>
      <g className="scene-dome-motion">
        <use href={`${domeUrl}#dome`} />
      </g>
    </Artwork>
  );
}

export function AwardDomeArtwork() {
  return (
    <svg
      className="award-dome-artwork"
      viewBox="500 930 900 560"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <use href={`${domeUrl}#dome`} />
    </svg>
  );
}
