import React, { useEffect } from 'react';
import { useThemeContext } from '../utils/ThemeContext';

const loaderStyles = `
  .fw-loader-ring {
    width: 3.25em;
    height: 3.25em;
    transform-origin: center;
    animation: fw-loader-rotate 2s linear infinite;
  }

  .fw-loader-ring circle {
    fill: none;
    stroke: hsl(214, 97%, 59%);
    stroke-width: 2;
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
    stroke-linecap: round;
    animation: fw-loader-dash 1.5s ease-in-out infinite;
  }

  @keyframes fw-loader-rotate {
    100% { transform: rotate(360deg); }
  }

  @keyframes fw-loader-dash {
    0% {
      stroke-dasharray: 1, 200;
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dasharray: 90, 200;
      stroke-dashoffset: -35px;
    }
    100% {
      stroke-dashoffset: -125px;
    }
  }
`;

const RingLoader = () => (
  <div className="flex justify-center">
    <style>{loaderStyles}</style>
    <svg className="fw-loader-ring" viewBox="25 25 50 50" aria-hidden="true">
      <circle r={20} cy={50} cx={50} />
    </svg>
  </div>
);

export const LoaderCard = ({
  title = "Working...",
  message = "Please wait while we finish this step.",
  compact = false,
}) => {
  const { isDarkMode = true, tokens = {} } = useThemeContext();
  const surface = tokens.surface || {};
  const text = tokens.text || {};
  const border = tokens.border || {};
  const shadow = tokens.shadow || {};

  return (
    <div
      className={`w-[min(90vw,360px)] rounded-[20px] text-center ${compact ? 'px-7 py-6' : 'px-8 py-8'}`}
      style={{
        background: isDarkMode
          ? (surface.elevatedGradient || 'linear-gradient(145deg, rgba(20,27,44,0.98), rgba(11,16,26,0.99))')
          : (surface.elevatedGradient || 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)'),
        color: text.primary || (isDarkMode ? '#f8fafc' : '#0f172a'),
        border: `1px solid ${border.modal || border.default || (isDarkMode ? 'rgba(255,255,255,0.16)' : '#e2e8f0')}`,
        boxShadow: shadow.modal || (isDarkMode
          ? 'inset 0 1px 0 rgba(255,255,255,0.14), 0 32px 90px -12px rgba(0,0,0,0.78)'
          : '0 26px 70px -34px rgba(15,23,42,0.58)'),
      }}
    >
      <RingLoader />
      <div
        className="mt-4 text-[15px] leading-6 tracking-0"
        style={{
          color: text.heading || text.primary || (isDarkMode ? '#f8fafc' : '#0f172a'),
          fontWeight: 650,
        }}
      >
        {title}
      </div>
      {message ? (
        <div
          className="mx-auto mt-1 max-w-[280px] text-[13px] font-normal leading-5"
          style={{ color: text.secondary || (isDarkMode ? '#94a3b8' : '#64748b') }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
};

export const LoaderPage = ({
  title = "Loading...",
  message = "Preparing your workspace.",
}) => {
  const { isDarkMode = true, tokens = {} } = useThemeContext();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="grid min-h-screen w-full place-items-center px-4"
      style={{
        background: isDarkMode
          ? (tokens.background?.app || '#0b0f19')
          : 'linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eff6ff 100%)',
      }}
    >
      <LoaderCard title={title} message={message} />
    </div>
  );
};

const LoaderOverlay = ({
  visible,
  label,
  title,
  message,
}) => {
  const { isDarkMode = true, tokens = {} } = useThemeContext();

  if (!visible) return null;

  const resolvedTitle = title || label || "Working...";

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-busy="true"
      className="fixed inset-0 z-[9999] grid place-items-center px-4 backdrop-blur-[2px]"
      style={{
        zIndex: 9999,
        background: tokens.overlay?.backdrop || (isDarkMode ? 'rgba(2, 6, 23, 0.72)' : 'rgba(15, 23, 42, 0.25)'),
      }}
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
