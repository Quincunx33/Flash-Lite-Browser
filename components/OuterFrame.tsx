import React, { useRef, useCallback, useState, useEffect } from 'react';
import { TokenCount } from '../types';

// Smooth interpolated counter — counts up toward target value
const AnimatedNumber: React.FC<{ value: number; prefix?: string; prefixVisible?: boolean; animate?: boolean }> = ({ value, prefix, prefixVisible = true, animate = true }) => {
  const [displayed, setDisplayed] = useState(0);
  const rafRef = useRef<number>(0);
  const currentRef = useRef(0);

  useEffect(() => {
    if (!animate) {
      cancelAnimationFrame(rafRef.current);
      currentRef.current = value;
      setDisplayed(value);
      return;
    }
    const target = value;
    const step = () => {
      const current = currentRef.current;
      const diff = target - current;
      if (Math.abs(diff) < 1) {
        currentRef.current = target;
        setDisplayed(target);
        return;
      }
      currentRef.current = current + diff * 0.15;
      setDisplayed(Math.round(currentRef.current));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, animate]);

  return (
    <span className="animated-number">
      {prefix && <span className="animated-prefix" style={{ opacity: prefixVisible ? 0.7 : 0 }}>{prefix}</span>}
      {displayed.toLocaleString()}
    </span>
  );
};

// Elapsed timer — starts when isActive becomes true, stops when it becomes false
const ElapsedTimer: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (isActive) {
      startRef.current = Date.now();
      const tick = () => {
        setElapsed((Date.now() - startRef.current) / 1000);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    } else if (startRef.current > 0) {
      setElapsed((Date.now() - startRef.current) / 1000);
    }
  }, [isActive]);

  return <span>{elapsed.toFixed(2)}s</span>;
};

interface OuterFrameProps {
  children: React.ReactNode;
  tokenCount: TokenCount | null;
  isLoading: boolean;
}

export const OuterFrame: React.FC<OuterFrameProps> = ({
  children,
  tokenCount,
  isLoading
}) => {
  // Linear zoom: 1.0 at ≤1080px viewport height, 1.5 at 1440px, etc.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const update = () => {
      const vh = window.innerHeight;
      setZoom(Math.max(1, 1 + (vh - 1080) * 0.5 / 360));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const isOutputPhase = (tokenCount?.output ?? 0) > 0;
  const arrowIcon = isOutputPhase ? 'arrow_downward' : 'arrow_upward';
  const phaseClass = isOutputPhase ? 'token-out' : 'token-in';
  const totalTokens = (tokenCount?.input ?? 0) + (tokenCount?.output ?? 0);

  const frameStyle: React.CSSProperties = zoom > 1 ? {
    zoom,
    width: `calc(100vw / ${zoom})`,
    height: `calc(100vh / ${zoom})`,
    ['--effective-vh' as string]: `calc(100vh / ${zoom})`,
  } : {};

  return (
    <div className="outer-frame" style={frameStyle}>
      <div className="main-container">
        {/* Header — same width as browser */}
        <div className="outer-header">
          <h1 className="outer-title">Flash-Lite Browser</h1>
          <div className="outer-caption-row">
            <p className="outer-caption">Imagine any website, generated in real-time by Gemini 3.1 Flash-Lite</p>
            {tokenCount && (
              <span className="token-display" aria-live="polite" aria-atomic="true">
                <span className={phaseClass}>
                  <span className="material-symbols-outlined token-icon" aria-hidden="true">
                    {isLoading ? arrowIcon : 'check'}
                  </span>
                  <AnimatedNumber value={totalTokens} prefix="~" prefixVisible={!!tokenCount.isEstimate} animate={isLoading} />
                </span>
                {' '}
                <span className="token-label">tokens in</span>
                {' '}
                <span className="token-label"><ElapsedTimer isActive={isLoading} /></span>
              </span>
            )}
          </div>
        </div>

        {/* Browser Container */}
        <div className="browser-container">
          {children}
        </div>
      </div>
      <div className="footer">Created by <a href="https://x.com/cobley_ben" target="_blank" rel="noopener noreferrer" className="footer-link">Ben Cobley</a></div>
    </div>
  );
};
