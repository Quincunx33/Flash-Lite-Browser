import React, { useState, useEffect, useRef } from 'react';
import { Breadcrumb } from '../types';
import { parseBreadcrumb, breadcrumbToDisplay } from '../utils/urlHelpers';

interface AddressBarProps {
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
  isGrounded: boolean;
  onToggleGrounding: () => void;
  htmlContent?: string;
  userApiKey?: string;
  onSaveApiKey?: (key: string) => void;
}

export const AddressBar: React.FC<AddressBarProps> = ({
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
  isGrounded,
  onToggleGrounding,
  htmlContent,
  userApiKey = '',
  onSaveApiKey,
}) => {
  const displayText = breadcrumbToDisplay(breadcrumb);
  const [inputVal, setInputVal] = useState(displayText);
  const [isFocused, setIsFocused] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localApiKey, setLocalApiKey] = useState(userApiKey);
  const [keySavedState, setKeySavedState] = useState<'idle' | 'saved'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleCopy = () => {
    if (!htmlContent) return;
    navigator.clipboard.writeText(htmlContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => {
        console.error('Failed to copy text: ', err);
      });
  };

  const handleDownload = () => {
    if (!htmlContent) return;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const site = breadcrumb.sitename || 'page';
    const subPage = breadcrumb.page || '';
    const nameSection = subPage ? `${site}_${subPage}` : site;
    const sanitized = nameSection.toLowerCase().replace(/[^a-z0-9_.-]/g, '_') || 'index';
    
    a.download = `${sanitized}.html`;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  const handleSaveKey = () => {
    if (onSaveApiKey) {
      onSaveApiKey(localApiKey);
      setKeySavedState('saved');
      setTimeout(() => setKeySavedState('idle'), 2000);
    }
  };

  useEffect(() => {
    setLocalApiKey(userApiKey);
  }, [userApiKey]);

  useEffect(() => {
    if (!isFocused) {
      if (!hasEdited) {
        setInputVal(displayText);
      }
    }
  }, [displayText, isFocused, hasEdited]);

  // When a new generation starts (loading becomes true), clear user edits
  // so the omnibar shows "Generating..." instead of stale user text
  useEffect(() => {
    if (isLoading) {
      setHasEdited(false);
    }
  }, [isLoading]);

  // Close menu on outside click, Escape key, or iframe click (window blur)
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const handleBlur = () => setMenuOpen(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('blur', handleBlur);
    };
  }, [menuOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim();
    if (!trimmed) return;

    const edited = parseBreadcrumb(trimmed);

    if (!edited.page && breadcrumb.page) {
      onNavigate('create', edited.sitename);
    } else if (edited.sitename !== breadcrumb.sitename) {
      onNavigate('create', trimmed);
    } else if (edited.page !== breadcrumb.page) {
      onNavigate('edit', edited.page);
    } else {
      onRefresh();
    }

    setHasEdited(false);
    inputRef.current?.blur();
  };

  const handleDomainClick = () => {
    if (breadcrumb.sitename && breadcrumb.page) {
      onNavigate('create', breadcrumb.sitename);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputVal(e.target.value);
    setHasEdited(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setInputVal(displayText);
      setHasEdited(false);
      inputRef.current?.blur();
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    if (!hasEdited) {
      setInputVal(displayText.replace(/ › /g, '.'));
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (!hasEdited) {
      setInputVal(displayText);
    }
  };

  const displayValue = isLoading && !isFocused && !breadcrumb.page
    ? 'Generating...'
    : isFocused ? inputVal : inputVal.replace(/\./g, ' › ');

  return (
    <div className="address-bar">
      {/* Nav Buttons */}
      <div className="nav-buttons">
        <button
          onClick={onBack}
          disabled={!canGoBack}
          className={`nav-btn ${!canGoBack ? 'disabled' : ''}`}
          title="Go back"
          aria-label="Go back"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <button
          onClick={onForward}
          disabled={!canGoForward}
          className={`nav-btn ${!canGoForward ? 'disabled' : ''}`}
          title="Go forward"
          aria-label="Go forward"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
        <button
          onClick={isLoading ? onStop : onRefresh}
          className="nav-btn"
          title={isLoading ? 'Stop loading' : 'Refresh'}
          aria-label={isLoading ? 'Stop loading' : 'Refresh'}
        >
          <span className="material-symbols-outlined">
            {isLoading ? 'close' : 'refresh'}
          </span>
        </button>
        <button onClick={onHome} className="nav-btn" title="Home" aria-label="Home">
          <span className="material-symbols-outlined">home</span>
        </button>
      </div>

      {/* Omnibar */}
      <form onSubmit={handleSubmit} className="omnibar-form" style={{ minWidth: '150px' }}>
        <div className="omnibar-wrapper">
          {isLoading && !inputVal ? (
            <div className="omnibar-loading">{loadingMessage}</div>
          ) : (
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={displayValue}
              onChange={handleChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="omnibar-input"
              aria-label="Address bar — enter a URL or prompt"
            />
          )}
        </div>
      </form>

      {/* Download and Copy Actions directly on AddressBar as quick access */}
      {htmlContent && (
        <div className="address-actions" style={{ display: 'flex', gap: '2px', marginLeft: '4px' }}>
          <button
            onClick={handleDownload}
            className="nav-btn action-btn-green"
            title="Download HTML Code"
            aria-label="Download HTML Code"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>download</span>
          </button>
          <button
            onClick={handleCopy}
            className="nav-btn action-btn-gray"
            style={{ color: copied ? '#81c995' : undefined }}
            title={copied ? "Copied!" : "Copy HTML Code"}
            aria-label="Copy HTML Code"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{copied ? "check" : "content_copy"}</span>
          </button>
        </div>
      )}

      {/* 3-dots Menu */}
      <div className="menu-container" ref={menuRef}>
        <button className="nav-btn" onClick={() => setMenuOpen(!menuOpen)} title="More options" aria-label="More options" aria-haspopup="true" aria-expanded={menuOpen}>
          <span className="material-symbols-outlined">more_vert</span>
        </button>
        {menuOpen && (
          <div className="dropdown-menu" role="menu">
            <label className="dropdown-menu-item" onClick={(e) => e.stopPropagation()}>
              <span>Search Grounding</span>
              <div
                className={`toggle-track ${isGrounded ? 'active' : ''}`}
                onClick={onToggleGrounding}
                role="switch"
                aria-checked={isGrounded}
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleGrounding();
                  }
                }}
              >
                <div className="toggle-thumb" />
              </div>
            </label>

            <div style={{ height: '1px', background: '#3c4043', margin: '8px 0' }} />
            
            <div className="px-4 py-2">
              <div className="text-[10px] text-[#9aa0a6] uppercase tracking-wider mb-2 font-medium">Settings</div>
              <div className="flex flex-col gap-2">
                <label className="text-[11px] text-[#c4c7cc]">Gemini API Key</label>
                <div className="flex gap-1">
                  <input
                    type="password"
                    value={localApiKey}
                    onChange={(e) => setLocalApiKey(e.target.value)}
                    placeholder="Enter key..."
                    className="flex-1 bg-[#202124] border border-[#444] rounded px-2 py-1 text-xs text-white focus:border-[#8ab4f8] outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveKey();
                    }}
                    className="p-1 rounded hover:bg-[#3c4043] text-[#9aa0a6] hover:text-[#8ab4f8]"
                    title="Save Key"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {keySavedState === 'saved' ? 'check' : 'save'}
                    </span>
                  </button>
                </div>
                <p className="text-[10px] text-[#9aa0a6]">Keys are stored locally in your browser.</p>
              </div>
            </div>

            {htmlContent && (
              <>
                <div style={{ height: '1px', background: '#3c4043', margin: '4px 0' }} />
                <button
                  className="dropdown-menu-item w-full text-left hover:bg-[#35363a] transition-colors"
                  style={{ width: '100%', background: 'transparent', textAlign: 'left', cursor: 'pointer', border: 'none', display: 'flex' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload();
                    setMenuOpen(false);
                  }}
                  role="menuitem"
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#81c995' }}>download</span>
                    <span>Download HTML</span>
                  </span>
                </button>
                <button
                  className="dropdown-menu-item w-full text-left hover:bg-[#35363a] transition-colors"
                  style={{ width: '100%', background: 'transparent', textAlign: 'left', cursor: 'pointer', border: 'none', display: 'flex' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                    setMenuOpen(false);
                  }}
                  role="menuitem"
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: copied ? '#81c995' : '#9aa0a6' }}>
                      {copied ? "check" : "content_copy"}
                    </span>
                    <span>{copied ? "Copied!" : "Copy HTML Code"}</span>
                  </span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
