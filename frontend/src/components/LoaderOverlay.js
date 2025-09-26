import React, { useEffect } from 'react';

const LoaderOverlay = ({ visible, label = "Working…" }) => {
  if (!visible) return null;

  return (
    <div 
      role="alert" 
      aria-live="assertive" 
      aria-busy="true"
      className="fixed inset-0 z-[9999] grid place-items-center bg-black/40"
      style={{ zIndex: 9999 }}
    >
      <div className="rounded-2xl bg-white p-6 shadow-xl text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <div className="text-sm font-medium text-gray-700">{label}</div>
      </div>
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