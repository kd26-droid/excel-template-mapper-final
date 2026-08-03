import React, { useEffect, useId } from 'react';

const loaderStyles = `
  .fw-loader {
    --cloud-color: #2563eb;
    --arrows-color: #93c5fd;
    --time-animation: 1.05s;
  }

  .fw-loader-cloud {
    width: 96px;
    height: 96px;
  }

  .fw-loader-cloud rect {
    fill: var(--cloud-color);
  }

  .fw-loader-arrows {
    transform-origin: 50% 72.8938%;
    fill: var(--arrows-color);
    filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.26));
    animation: fw-loader-rotation var(--time-animation) linear infinite;
  }

  .fw-loader-cloud circle {
    animation: fw-loader-cloud calc(var(--time-animation) * 2) linear infinite;
  }

  .fw-loader-cloud circle:nth-child(2) {
    animation-delay: calc((var(--time-animation) * 2) / -3);
  }

  .fw-loader-cloud circle:nth-child(3) {
    animation-delay: calc((var(--time-animation) * 2) / -1.5);
  }

  .fw-loader-lines line {
    stroke-width: 5;
    transform-origin: 50% 50%;
    rotate: -65deg;
    animation: fw-loader-lines calc(var(--time-animation) / 1.33) linear infinite;
  }

  @keyframes fw-loader-rotation {
    0% { transform: rotate(0deg); }
    50% { transform: rotate(180deg); }
    100% { transform: rotate(360deg); }
  }

  @keyframes fw-loader-lines {
    0% { transform: translateY(-10px); }
    100% { transform: translateY(8px); }
  }

  @keyframes fw-loader-cloud {
    0% { cx: 20; cy: 60; r: 15; }
    50% { cx: 50; cy: 45; r: 20; }
    100% { cx: 80; cy: 60; r: 15; }
  }
`;

const CloudSyncLoader = () => {
  const reactId = useId();
  const safeId = reactId.replace(/:/g, '');
  const roundnessId = `fw-loader-roundness-${safeId}`;
  const shapesId = `fw-loader-shapes-${safeId}`;
  const clippingId = `fw-loader-clipping-${safeId}`;

  return (
    <div className="fw-loader flex justify-center">
      <style>{loaderStyles}</style>
      <svg className="fw-loader-cloud" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <filter id={roundnessId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
            <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -10" />
          </filter>
          <mask id={shapesId}>
            <g fill="white">
              <polygon points="50 37.5 80 75 20 75 50 37.5" />
              <circle cx={20} cy={60} r={15} />
              <circle cx={80} cy={60} r={15} />
              <g>
                <circle cx={20} cy={60} r={15} />
                <circle cx={20} cy={60} r={15} />
                <circle cx={20} cy={60} r={15} />
              </g>
            </g>
          </mask>
          <mask id={clippingId} clipPathUnits="userSpaceOnUse">
            <g filter={`url(#${roundnessId})`}>
              <g className="fw-loader-lines" mask={`url(#${shapesId})`} stroke="white">
                <line x1={-50} y1={-40} x2={150} y2={-40} />
                <line x1={-50} y1={-31} x2={150} y2={-31} />
                <line x1={-50} y1={-22} x2={150} y2={-22} />
                <line x1={-50} y1={-13} x2={150} y2={-13} />
                <line x1={-50} y1={-4} x2={150} y2={-4} />
                <line x1={-50} y1={5} x2={150} y2={5} />
                <line x1={-50} y1={14} x2={150} y2={14} />
                <line x1={-50} y1={23} x2={150} y2={23} />
                <line x1={-50} y1={32} x2={150} y2={32} />
                <line x1={-50} y1={41} x2={150} y2={41} />
                <line x1={-50} y1={50} x2={150} y2={50} />
                <line x1={-50} y1={59} x2={150} y2={59} />
                <line x1={-50} y1={68} x2={150} y2={68} />
                <line x1={-50} y1={77} x2={150} y2={77} />
                <line x1={-50} y1={86} x2={150} y2={86} />
                <line x1={-50} y1={95} x2={150} y2={95} />
                <line x1={-50} y1={104} x2={150} y2={104} />
                <line x1={-50} y1={113} x2={150} y2={113} />
                <line x1={-50} y1={122} x2={150} y2={122} />
                <line x1={-50} y1={131} x2={150} y2={131} />
                <line x1={-50} y1={140} x2={150} y2={140} />
              </g>
            </g>
          </mask>
        </defs>
        <rect x={0} y={0} width={100} height={100} rx={0} ry={0} mask={`url(#${clippingId})`} />
        <g className="fw-loader-arrows">
          <path d="M33.52,68.12 C35.02,62.8 39.03,58.52 44.24,56.69 C49.26,54.93 54.68,55.61 59.04,58.4 C59.04,58.4 56.24,60.53 56.24,60.53 C55.45,61.13 55.68,62.37 56.63,62.64 C56.63,62.64 67.21,65.66 67.21,65.66 C67.98,65.88 68.75,65.3 68.74,64.5 C68.74,64.5 68.68,53.5 68.68,53.5 C68.67,52.51 67.54,51.95 66.75,52.55 C66.75,52.55 64.04,54.61 64.04,54.61 C57.88,49.79 49.73,48.4 42.25,51.03 C35.2,53.51 29.78,59.29 27.74,66.49 C27.29,68.08 28.22,69.74 29.81,70.19 C30.09,70.27 30.36,70.31 30.63,70.31 C31.94,70.31 33.14,69.44 33.52,68.12Z" />
          <path d="M69.95,74.85 C68.35,74.4 66.7,75.32 66.25,76.92 C64.74,82.24 60.73,86.51 55.52,88.35 C50.51,90.11 45.09,89.43 40.73,86.63 C40.73,86.63 43.53,84.51 43.53,84.51 C44.31,83.91 44.08,82.67 43.13,82.4 C43.13,82.4 32.55,79.38 32.55,79.38 C31.78,79.16 31.02,79.74 31.02,80.54 C31.02,80.54 31.09,91.54 31.09,91.54 C31.09,92.53 32.22,93.09 33.01,92.49 C33.01,92.49 35.72,90.43 35.72,90.43 C39.81,93.63 44.77,95.32 49.84,95.32 C52.41,95.32 55,94.89 57.51,94.01 C64.56,91.53 69.99,85.75 72.02,78.55 C72.47,76.95 71.54,75.3 69.95,74.85Z" />
        </g>
      </svg>
    </div>
  );
};

export const LoaderCard = ({
  title = "Working...",
  message = "Please wait while we finish this step.",
  compact = false,
}) => (
  <div className={`w-[min(90vw,360px)] rounded-[20px] bg-white text-center shadow-[0_26px_70px_-34px_rgba(15,23,42,0.58)] ring-1 ring-slate-200/80 ${compact ? 'px-7 py-6' : 'px-8 py-8'}`}>
    <CloudSyncLoader />
    <div className="mt-4 text-[15px] font-semibold leading-6 text-slate-800">{title}</div>
    {message ? (
      <div className="mx-auto mt-1 max-w-[280px] text-[13px] font-normal leading-5 text-slate-500">
        {message}
      </div>
    ) : null}
  </div>
);

export const LoaderPage = ({
  title = "Loading...",
  message = "Preparing your workspace.",
}) => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="grid min-h-screen w-full place-items-center bg-gradient-to-br from-slate-50 via-white to-blue-50 px-4"
  >
    <LoaderCard title={title} message={message} />
  </div>
);

const LoaderOverlay = ({
  visible,
  label,
  title,
  message,
}) => {
  if (!visible) return null;

  const resolvedTitle = title || label || "Working...";

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-busy="true"
      className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/45 px-4 backdrop-blur-[2px]"
      style={{ zIndex: 9999 }}
    >
      <LoaderCard title={resolvedTitle} message={message} compact />
    </div>
  );
};

export const useGlobalBlock = (visible) => {
  useEffect(() => {
    const el = document.getElementById('app-content') || document.getElementById('root');
    if (!el) return;

    if (visible) {
      el.setAttribute('inert', '');
    } else {
      el.removeAttribute('inert');
    }

    return () => {
      el.removeAttribute('inert');
    };
  }, [visible]);
};

export default LoaderOverlay;
