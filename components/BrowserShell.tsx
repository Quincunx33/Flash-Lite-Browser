import React, { useRef, useCallback, useState, useEffect } from 'react';
import { AddressBar } from './AddressBar';
import { Breadcrumb, GroundingSource, Tab } from '../types';

interface BrowserShellProps {
  children: React.ReactNode;
  breadcrumb: Breadcrumb;
  isLoading: boolean;
  loadingMessage: string;
  onNavigate: (type: 'create' | 'edit', prompt: string) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onStop: () => void;
  onHome: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  groundingSources: GroundingSource[];
  searchEntryPointHtml: string;
  tabs: Tab[];
  activeTabIndex: number;
  onNewTab: () => void;
  onCloseTab: (index: number) => void;
  onSwitchTab: (index: number) => void;
  isGrounded: boolean;
  onToggleGrounding: () => void;
  htmlContent?: string;
  userApiKey?: string;
  onSaveApiKey?: (key: string) => void;
  onShowLibrary?: () => void;
}

export const BrowserShell: React.FC<BrowserShellProps> = ({
  children,
  breadcrumb,
  isLoading,
  loadingMessage,
  onNavigate,
  onBack,
  onForward,
  onRefresh,
  onStop,
  onHome,
  canGoBack,
  canGoForward,
  groundingSources,
  searchEntryPointHtml,
  tabs,
  activeTabIndex,
  onNewTab,
  onCloseTab,
  onSwitchTab,
  isGrounded,
  onToggleGrounding,
  htmlContent,
  userApiKey,
  onSaveApiKey,
  onShowLibrary,
}) => {
  const shellRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      shellRef.current?.requestFullscreen?.();
    }
  }, []);

  const getTabTitle = (tab: Tab, index: number) => {
    if (tab.loading) return 'Generating...';
    const bc = tab.breadcrumb;
    return bc.page || bc.sitename || 'New Tab';
  };

  return (
    <div className="browser-shell" ref={shellRef}>
      {/* Tab Bar */}
      <div className="tab-bar">
        <div className="tab-list" role="tablist">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={`tab ${index === activeTabIndex ? 'active-tab' : ''}`}
              onClick={() => onSwitchTab(index)}
              role="tab"
              tabIndex={0}
              aria-selected={index === activeTabIndex}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSwitchTab(index);
                }
              }}
            >
              {tab.loading && <div className="tab-spinner" aria-hidden="true" />}
              <span className="tab-title">
                {getTabTitle(tab, index)}
              </span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(index);
                }}
                title="Close tab"
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          ))}
          <button className="tab-new" onClick={onNewTab} title="New Tab" aria-label="New Tab">
            <span>+</span>
          </button>
        </div>
        {/* Fullscreen button — right side of tab bar */}
        <button className="tab-bar-btn" onClick={handleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
          <span className="material-symbols-outlined">{isFullscreen ? 'close_fullscreen' : 'fullscreen'}</span>
        </button>
      </div>

      {/* Address Bar */}
      <AddressBar
        breadcrumb={breadcrumb}
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        onNavigate={onNavigate}
        onBack={onBack}
        onForward={onForward}
        onRefresh={onRefresh}
        onStop={onStop}
        onHome={onHome}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isGrounded={isGrounded}
        onToggleGrounding={onToggleGrounding}
        htmlContent={htmlContent}
        userApiKey={userApiKey}
        onSaveApiKey={onSaveApiKey}
        onShowLibrary={onShowLibrary}
      />

      {/* Viewport */}
      <div className="browser-viewport">
        {children}
      </div>

      {/* Grounding Attribution Row */}
      {(groundingSources.length > 0 || searchEntryPointHtml) && (
        <div className="grounding-row">
          {/* Source Chips */}
          {groundingSources.length > 0 && (
            <div className="sources-container">
              <div className="sources-row">
                {groundingSources.map((source, i) => (
                  <a
                    key={i}
                    className="source-chip"
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={source.title}
                  >
                    <img
                      className="source-favicon"
                      src={`https://www.google.com/s2/favicons?sz=16&domain=${source.title}`}
                      alt=""
                    />
                    {source.title}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Google Search Suggestions Widget */}
          {searchEntryPointHtml && (
            <iframe
              srcDoc={`<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.href){e.preventDefault();window.open(a.href,'_blank');}});</script>${searchEntryPointHtml}`}
              className="search-widget-iframe"
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              title="Search Suggestions"
            />
          )}
        </div>
      )}
    </div>
  );
};