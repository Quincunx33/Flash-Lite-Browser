import React, { useState, useCallback, useRef, useEffect } from 'react';
import { OuterFrame } from './components/OuterFrame';
import { BrowserShell } from './components/BrowserShell';
import { Sandbox } from './components/Sandbox';
import { NewTab } from './components/NewTab';
import { DisclaimerPopup } from './components/DisclaimerPopup';
import { streamPageGeneration } from './services/geminiService';
import { Page, Breadcrumb, TokenCount, FormFieldState, GroundingSource, Tab, createTab } from './types';
import { siteNameFromPrompt, parsePageFromHref, extractTitleFromHtml } from './utils/urlHelpers';
import { savePage, getSavedPages, SavedPage, deleteSavedPage } from './services/db';

const App: React.FC = () => {
  // Tab state
  const [tabs, setTabs] = useState<Tab[]>([createTab()]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // Global controls (shared across tabs)
  const [isGrounded, setIsGrounded] = useState(false);
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    return localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || '';
  });

  // Saved Pages state
  const [savedPages, setSavedPages] = useState<SavedPage[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  // Abort controllers keyed by tab id
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<{ html: string; tag: string; text: string } | null>(null);
  const [refinementPrompt, setRefinementPrompt] = useState('');

  // -- Helper to update the active tab immutably --
  const updateTab = useCallback((tabIndex: number, updater: (tab: Tab) => Tab) => {
    setTabs(prev => prev.map((t, i) => i === tabIndex ? updater(t) : t));
  }, []);

  const activeTab = tabs[activeTabIndex];
  const currentPage = activeTab.currentIndex >= 0 ? activeTab.history[activeTab.currentIndex] : null;

  const loadSavedPages = useCallback(async () => {
    try {
      const pages = await getSavedPages();
      setSavedPages(pages);
    } catch (e) {
      console.error('Failed to load saved pages', e);
    }
  }, []);

  useEffect(() => {
    loadSavedPages();
  }, [loadSavedPages]);

  const handleSaveToDB = useCallback(async (page: Page) => {
    const id = btoa(page.breadcrumb.sitename + page.breadcrumb.page + page.timestamp).substring(0, 10);
    const saved: SavedPage = {
      id,
      name: page.breadcrumb.page || 'Home',
      sitename: page.breadcrumb.sitename,
      html: page.html,
      prompt: page.prompt,
      timestamp: page.timestamp
    };
    await savePage(saved);
    loadSavedPages();
  }, [loadSavedPages]);

  // -- Core Generation Logic --
  const generate = useCallback(async (
    prompt: string,
    currentHtml: string | null,
    fallbackBreadcrumb: Breadcrumb,
    pushHistory: boolean = true,
    formState?: FormFieldState[]
  ) => {
    const tabIndex = activeTabIndex;
    const tabId = tabs[tabIndex].id;

    // Abort controllers keyed by tab id
    if (!abortControllersRef.current) abortControllersRef.current = new Map();
    
    // Abort any in-flight request for this tab
    const existingController = abortControllersRef.current.get(tabId);
    if (existingController) {
      existingController.abort();
    }
    const controller = new AbortController();
    abortControllersRef.current.set(tabId, controller);

    updateTab(tabIndex, tab => ({
      ...tab,
      loading: true,
      loadingMessage: 'Streaming website from Gemini 3.1 Flash',
      generatedContent: '',
      tokenCount: null,
      groundingSources: [],
      searchEntryPointHtml: '',
      breadcrumb: { sitename: fallbackBreadcrumb.sitename, page: '' },
      ...(pushHistory ? { navigationId: tab.navigationId + 1 } : {}),
    }));

    let fullHtml = '';
    let pageTokenCount: TokenCount = { input: 0, output: 0 };
    let pageGroundingSources: GroundingSource[] = [];
    let pageSearchEntryPointHtml = '';
    let titleExtracted = false;
    let streamBuffer = '';

    try {
      const stream = streamPageGeneration(prompt, currentHtml, isGrounded, controller.signal, formState, window.innerWidth <= 768, userApiKey);

      for await (const chunk of stream) {
        if (controller.signal.aborted) break;

        streamBuffer += chunk;

        // Process markers in the buffer
        let searchIndex = 0;
        while (true) {
          // Look for any marker start
          const tokenStart = streamBuffer.indexOf('__TOKEN__', searchIndex);
          const metaStart = streamBuffer.indexOf('__META__', searchIndex);
          
          const firstStart = (tokenStart !== -1 && (metaStart === -1 || tokenStart < metaStart)) 
            ? { start: tokenStart, type: 'TOKEN' as const }
            : (metaStart !== -1) 
              ? { start: metaStart, type: 'META' as const }
              : null;

          if (!firstStart) break;

          // Look for the end of the JSON object
          const jsonStart = firstStart.start + (firstStart.type === 'TOKEN' ? 9 : 8);
          const jsonEnd = streamBuffer.indexOf('}', jsonStart);

          if (jsonEnd === -1) {
            // Partial marker found, wait for more data
            break;
          }

          const fullMarker = streamBuffer.substring(firstStart.start, jsonEnd + 1);
          const jsonStr = streamBuffer.substring(jsonStart, jsonEnd + 1);

          try {
            const data = JSON.parse(jsonStr);
            if (firstStart.type === 'TOKEN') {
              pageTokenCount = { input: data.input, output: data.output, isEstimate: data.isEstimate };
              updateTab(tabIndex, tab => ({ ...tab, tokenCount: pageTokenCount }));
            } else if (firstStart.type === 'META') {
              if (data.tokenCount) {
                pageTokenCount = data.tokenCount;
                updateTab(tabIndex, tab => ({ ...tab, tokenCount: data.tokenCount }));
              }
              if (data.groundingSources?.length) {
                pageGroundingSources = data.groundingSources;
                updateTab(tabIndex, tab => ({ ...tab, groundingSources: data.groundingSources }));
              }
              if (data.searchEntryPointHtml) {
                pageSearchEntryPointHtml = data.searchEntryPointHtml;
                updateTab(tabIndex, tab => ({ ...tab, searchEntryPointHtml: data.searchEntryPointHtml }));
              }
            }
          } catch (e) {
            console.warn("Failed to parse marker JSON", e);
          }

          // Move everything BEFORE the marker to fullHtml
          fullHtml += streamBuffer.substring(0, firstStart.start);
          // Remove pre-marker text AND the marker from the buffer
          streamBuffer = streamBuffer.substring(jsonEnd + 1);
          searchIndex = 0; // Reset search since buffer changed
        }

        // After processing all markers, anything left in the buffer that is NOT 
        // part of a valid potential marker can be moved to fullHtml.
        const tokenStart = streamBuffer.indexOf('__TOKEN__');
        const metaStart = streamBuffer.indexOf('__META__');
        
        const firstStart = (tokenStart !== -1 && (metaStart === -1 || tokenStart < metaStart)) 
          ? tokenStart 
          : metaStart;

        if (firstStart === -1) {
          // No full or partial marker starts found here.
          // BUT, the buffer might end with a PARTIAL start like "__TOK"
          const lastUnderscore = streamBuffer.lastIndexOf('__');
          if (lastUnderscore !== -1 && lastUnderscore > streamBuffer.length - 10) {
            // Potential marker starting at the end of buffer, preserve it
            fullHtml += streamBuffer.substring(0, lastUnderscore);
            streamBuffer = streamBuffer.substring(lastUnderscore);
          } else {
            // No markers at all
            fullHtml += streamBuffer;
            streamBuffer = '';
          }
        } else if (firstStart > 0) {
          // Move everything up to the marker start
          fullHtml += streamBuffer.substring(0, firstStart);
          streamBuffer = streamBuffer.substring(firstStart);
        }

        let extractedBreadcrumb: Breadcrumb | null = null;
        if (!titleExtracted && fullHtml.includes('</title>')) {
          extractedBreadcrumb = extractTitleFromHtml(fullHtml);
          if (extractedBreadcrumb) titleExtracted = true;
        }

        updateTab(tabIndex, tab => ({
          ...tab,
          generatedContent: fullHtml,
          loadingMessage: 'Streaming website from Gemini 3.1 Flash',
          tokenCount: pageTokenCount,
          ...(extractedBreadcrumb ? { breadcrumb: extractedBreadcrumb } : {}),
        }));
      }

      if (controller.signal.aborted) return;

      const finalBreadcrumb = titleExtracted
        ? (extractTitleFromHtml(fullHtml) || fallbackBreadcrumb)
        : fallbackBreadcrumb;

      const newPage: Page = {
        html: fullHtml,
        breadcrumb: finalBreadcrumb,
        scrollPosition: 0,
        timestamp: Date.now(),
        tokenCount: pageTokenCount,
        prompt,
        contextHtml: currentHtml,
        isGrounded,
        groundingSources: pageGroundingSources,
        searchEntryPointHtml: pageSearchEntryPointHtml,
      };

      updateTab(tabIndex, tab => {
        if (pushHistory) {
          const newHistory = [...tab.history.slice(0, tab.currentIndex + 1), newPage];
          // Auto-save generated pages
          handleSaveToDB(newPage);
          return {
            ...tab,
            history: newHistory,
            currentIndex: newHistory.length - 1,
            breadcrumb: finalBreadcrumb,
            tokenCount: pageTokenCount,
          };
        } else {
          const updated = [...tab.history];
          if (tab.currentIndex >= 0) {
            updated[tab.currentIndex] = newPage;
          }
          return {
            ...tab,
            history: updated,
            breadcrumb: finalBreadcrumb,
            tokenCount: pageTokenCount,
          };
        }
      });

    } catch (e: any) {
      if (e?.name === 'AbortError' || controller.signal.aborted) return;
      console.error('Generation failed', e);
      const errorMessage = e instanceof Error ? e.message : 'Failed to generate page';
      
      const is503 = errorMessage.includes('503') || errorMessage.toLowerCase().includes('high demand') || errorMessage.toLowerCase().includes('unavailable');
      const isApiKeyError = !is503 && (errorMessage.toLowerCase().includes('api key') || errorMessage.toLowerCase().includes('environment variable'));
      
      const title = is503 ? 'Gemini is Busy' : 'Generation Failed';
      const detail = is503 
        ? 'The model is currently experiencing very high demand. This is usually temporary and resolves in a few seconds.'
        : errorMessage;
      const icon = is503 ? 'speed' : 'error';
      const iconColor = is503 ? '#8ab4f8' : '#f28b82';

      const errorHtml = `<div style="padding: 40px; font-family: 'Google Sans', sans-serif; background: #121212; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center;">
          <div style="max-width: 500px; width: 100%; background: #1e1e1e; border: 1px solid #333; border-radius: 16px; padding: 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); text-align: center;">
            <div style="background: rgba(${is503 ? '138, 180, 248' : '217, 48, 37'}, 0.1); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px;">
              <span class="material-symbols-outlined" style="color: ${iconColor}; font-size: 32px;">${icon}</span>
            </div>
            <h1 style="color: #fff; margin: 0 0 12px; font-size: 24px; font-weight: 500;">${title}</h1>
            <p style="font-size: 16px; line-height: 1.6; color: #9aa0a6; margin: 0 0 24px;">${detail}</p>
            
            ${isApiKeyError ? `
              <div style="margin-bottom: 24px; padding: 16px; background: #2a2a2a; border-radius: 8px; text-align: left; border-left: 4px solid #8ab4f8;">
                <p style="margin: 0; font-size: 13px; color: #8ab4f8; font-weight: 500;">Instruction</p>
                <p style="margin: 4px 0 0; font-size: 13px; color: #c4c7cc;">Please set your <b>Gemini API Key</b> in the browser settings menu (3-dots icon) or in the Studio's Environment Variables.</p>
              </div>
            ` : ''}
            
            <div style="display: flex; gap: 12px; justify-content: center;">
              <button onclick="window.location.reload()" style="padding: 12px 24px; background: #333; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; font-family: inherit; transition: background 0.2s;">
                Reload App
              </button>
              <button onclick="FlashLiteAPI.performAction('Retry generation')" style="padding: 12px 24px; background: #8ab4f8; color: #000; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; font-family: inherit; transition: opacity 0.2s;">
                Try Again
              </button>
            </div>
          </div>
        </div>`;

      const errorPage: Page = {
        html: errorHtml,
        breadcrumb: { sitename: 'Error', page: 'Failed to generate' },
        scrollPosition: 0,
        timestamp: Date.now(),
        tokenCount: null,
        prompt,
        contextHtml: currentHtml,
        isGrounded,
        groundingSources: [],
        searchEntryPointHtml: '',
      };

      updateTab(tabIndex, tab => {
        const newHistory = [...tab.history.slice(0, tab.currentIndex + 1), errorPage];
        return {
          ...tab,
          history: newHistory,
          currentIndex: newHistory.length - 1,
          generatedContent: errorHtml,
          breadcrumb: errorPage.breadcrumb,
          tokenCount: null,
        };
      });
    } finally {
      if (abortControllersRef.current.get(tabId) === controller) {
        updateTab(tabIndex, tab => ({
          ...tab,
          loading: false,
          loadingMessage: '',
        }));
        abortControllersRef.current.delete(tabId);
      }
    }
  }, [isGrounded, activeTabIndex, tabs, updateTab, userApiKey, handleSaveToDB]);

  const handleDeleteSaved = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSavedPage(id);
    loadSavedPages();
  }, [loadSavedPages]);

  const handleLoadSaved = useCallback((saved: SavedPage) => {
    const tabIndex = activeTabIndex;
    const newPage: Page = {
      html: saved.html,
      breadcrumb: { sitename: saved.sitename, page: saved.name },
      scrollPosition: 0,
      timestamp: Date.now(),
      tokenCount: null,
      prompt: saved.prompt,
      contextHtml: null,
      isGrounded: false,
      groundingSources: [],
      searchEntryPointHtml: ''
    };

    updateTab(tabIndex, tab => {
      const newHistory = [...tab.history.slice(0, tab.currentIndex + 1), newPage];
      return {
        ...tab,
        history: newHistory,
        currentIndex: newHistory.length - 1,
        generatedContent: saved.html,
        breadcrumb: newPage.breadcrumb,
      };
    });
    setShowLibrary(false);
  }, [activeTabIndex, updateTab]);

  const handleElementSelected = useCallback((data: { html: string; tag: string; text: string }) => {
    setSelectedElement(data);
    setSelectionMode(false);
  }, []);

  const handleRefine = useCallback(() => {
    if (!selectedElement || !refinementPrompt) return;
    
    // Construct refinement prompt
    const fullPrompt = `Refine this ${selectedElement.tag}: "${selectedElement.text}". \nRefinement instruction: ${refinementPrompt}`;
    
    // We treat this like a link click but passing the context of the selected element
    if (currentPage) {
      // We pass the full HTML but mark the selected element in the prompt or context
      generate(fullPrompt, currentPage.html, activeTab.breadcrumb, true);
    }
    
    setSelectedElement(null);
    setRefinementPrompt('');
  }, [selectedElement, refinementPrompt, currentPage, activeTab.breadcrumb, generate]);

  const handleSaveApiKey = useCallback((key: string) => {
    setUserApiKey(key);
    if (key) {
      localStorage.setItem('GEMINI_API_KEY_OVERRIDE', key);
    } else {
      localStorage.removeItem('GEMINI_API_KEY_OVERRIDE');
    }
  }, []);

  // -- Stop loading --
  const handleStop = useCallback(() => {
    const tabId = activeTab.id;
    const controller = abortControllersRef.current.get(tabId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(tabId);
    }
    updateTab(activeTabIndex, tab => ({
      ...tab,
      loading: false,
      loadingMessage: '',
    }));
  }, [activeTab, activeTabIndex, updateTab]);

  // ============================================================
  // ALL PAGE GENERATION TRIGGERS
  // ============================================================

  const handleCreate = useCallback((prompt: string) => {
    const fallback: Breadcrumb = { sitename: siteNameFromPrompt(prompt), page: 'Home' };
    generate(prompt, null, fallback, true);
  }, [generate]);

  const handleLinkClick = useCallback((href: string, linkText: string, formState?: FormFieldState[]) => {
    const prompt = `User clicked "${linkText}" (href: ${href})`;
    const isExternal = /^https?:\/\//i.test(href) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(href);

    if (isExternal) {
      const domain = href.replace(/^https?:\/\//, '').split('/')[0];
      const sitename = domain.replace(/^www\./, '').split('.')[0];
      const capitalizedSitename = sitename.charAt(0).toUpperCase() + sitename.slice(1);
      const fallback: Breadcrumb = { sitename: capitalizedSitename, page: 'Home' };
      generate(prompt, null, fallback, true, formState);
    } else {
      const currentSitename = activeTab.breadcrumb.sitename || 'Site';
      const page = parsePageFromHref(href);
      const fallback: Breadcrumb = { sitename: currentSitename, page };
      if (currentPage) {
        generate(prompt, currentPage.html, fallback, true, formState);
      } else {
        generate(prompt, null, fallback, true, formState);
      }
    }
  }, [generate, currentPage, activeTab.breadcrumb]);

  const handleAction = useCallback((intent: string, payload?: string, formState?: FormFieldState[]) => {
    if (!currentPage) return;
    const actionPrompt = payload ? `${intent}: ${payload}` : intent;
    generate(actionPrompt, currentPage.html, activeTab.breadcrumb, false, formState);
  }, [generate, currentPage, activeTab.breadcrumb]);

  const handleOmnibarNavigate = useCallback((type: 'create' | 'edit', prompt: string) => {
    if (type === 'create') {
      const fallback: Breadcrumb = { sitename: prompt, page: 'Home' };
      generate(prompt, null, fallback, true);
    } else {
      if (!currentPage) return;
      const fallback: Breadcrumb = { sitename: activeTab.breadcrumb.sitename, page: prompt };
      generate(prompt, currentPage.html, fallback, false);
    }
  }, [generate, currentPage, activeTab.breadcrumb]);

  const handleBack = useCallback(() => {
    if (activeTab.currentIndex > 0) {
      updateTab(activeTabIndex, tab => {
        const newIndex = tab.currentIndex - 1;
        const page = tab.history[newIndex];
        return {
          ...tab,
          currentIndex: newIndex,
          navigationId: tab.navigationId + 1,
          generatedContent: page.html,
          breadcrumb: page.breadcrumb,
          tokenCount: page.tokenCount,
          groundingSources: page.groundingSources || [],
          searchEntryPointHtml: page.searchEntryPointHtml || '',
        };
      });
      // Update grounding to match the page
      const page = activeTab.history[activeTab.currentIndex - 1];
      if (page) setIsGrounded(page.isGrounded);
    }
  }, [activeTab, activeTabIndex, updateTab]);

  const handleForward = useCallback(() => {
    if (activeTab.currentIndex < activeTab.history.length - 1) {
      updateTab(activeTabIndex, tab => {
        const newIndex = tab.currentIndex + 1;
        const page = tab.history[newIndex];
        return {
          ...tab,
          currentIndex: newIndex,
          navigationId: tab.navigationId + 1,
          generatedContent: page.html,
          breadcrumb: page.breadcrumb,
          tokenCount: page.tokenCount,
          groundingSources: page.groundingSources || [],
          searchEntryPointHtml: page.searchEntryPointHtml || '',
        };
      });
      const page = activeTab.history[activeTab.currentIndex + 1];
      if (page) setIsGrounded(page.isGrounded);
    }
  }, [activeTab, activeTabIndex, updateTab]);

  const handleRefresh = useCallback(() => {
    if (currentPage) {
      generate(currentPage.prompt, currentPage.contextHtml, currentPage.breadcrumb, false);
    }
  }, [currentPage, generate]);

  const handleHome = useCallback(() => {
    // Abort any in-flight request
    const tabId = activeTab.id;
    const controller = abortControllersRef.current.get(tabId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(tabId);
    }

    updateTab(activeTabIndex, tab => ({
      ...tab,
      currentIndex: -1,
      loading: false,
      loadingMessage: '',
      generatedContent: '',
      breadcrumb: { sitename: '', page: '' },
      tokenCount: null,
      groundingSources: [],
      searchEntryPointHtml: '',
    }));
  }, [activeTab, activeTabIndex, updateTab]);

  // ============================================================
  // TAB MANAGEMENT
  // ============================================================

  const handleNewTab = useCallback(() => {
    const newTab = createTab();
    setTabs(prev => [...prev, newTab]);
    setActiveTabIndex(tabs.length); // new tab is at the end
  }, [tabs.length]);

  const handleCloseTab = useCallback((index: number) => {
    // Abort any in-flight request for the closing tab
    const closingTab = tabs[index];
    const controller = abortControllersRef.current.get(closingTab.id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(closingTab.id);
    }

    if (tabs.length === 1) {
      // Last tab — replace with a fresh one
      const newTab = createTab();
      setTabs([newTab]);
      setActiveTabIndex(0);
    } else {
      setTabs(prev => prev.filter((_, i) => i !== index));
      if (activeTabIndex >= index && activeTabIndex > 0) {
        setActiveTabIndex(prev => prev - 1);
      }
    }
  }, [tabs, activeTabIndex]);

  const handleSwitchTab = useCallback((index: number) => {
    setActiveTabIndex(index);
  }, []);

  const isNewTab = activeTab.currentIndex === -1 && !activeTab.loading;
  const displayContent = activeTab.loading ? activeTab.generatedContent : (currentPage?.html || '');

  return (
    <OuterFrame
      tokenCount={activeTab.tokenCount}
      isLoading={activeTab.loading}
    >
      <BrowserShell
        breadcrumb={activeTab.breadcrumb}
        isLoading={activeTab.loading}
        loadingMessage={activeTab.loadingMessage}
        onNavigate={handleOmnibarNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onRefresh={handleRefresh}
        onStop={handleStop}
        onHome={handleHome}
        canGoBack={activeTab.currentIndex > 0}
        canGoForward={activeTab.currentIndex < activeTab.history.length - 1}
        groundingSources={activeTab.groundingSources}
        searchEntryPointHtml={activeTab.searchEntryPointHtml}
        tabs={tabs}
        activeTabIndex={activeTabIndex}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onSwitchTab={handleSwitchTab}
        isGrounded={isGrounded}
        onToggleGrounding={() => setIsGrounded(prev => !prev)}
        htmlContent={displayContent}
        userApiKey={userApiKey}
        onSaveApiKey={handleSaveApiKey}
        onShowLibrary={() => setShowLibrary(true)}
      >
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {isNewTab ? (
            <NewTab onCreatePage={handleCreate} />
          ) : (
            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <Sandbox
                htmlContent={displayContent}
                onNavigate={handleLinkClick}
                onAction={handleAction}
                selectionMode={selectionMode}
                onElementSelected={handleElementSelected}
              />

              {/* Selection Mode Indicator */}
              {selectionMode && (
                <div style={{ 
                  position: 'absolute', 
                  top: '12px', 
                  left: '50%', 
                  transform: 'translateX(-50%)', 
                  zIndex: 100, 
                  background: '#8ab4f8', 
                  color: '#000', 
                  padding: '8px 16px', 
                  borderRadius: '24px', 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 600,
                  fontSize: '14px'
                }}>
                  <span className="material-symbols-outlined">touch_app</span>
                  Tap any element to prompt
                  <button 
                    onClick={() => setSelectionMode(false)}
                    style={{ background: 'rgba(0,0,0,0.1)', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyCenter: 'center', padding: 0 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                  </button>
                </div>
              )}

              {/* Refinement Prompt Bar */}
              {selectedElement && (
                <div style={{ 
                  position: 'absolute', 
                  bottom: '24px', 
                  left: '50%', 
                  transform: 'translateX(-50%)', 
                  zIndex: 100, 
                  background: '#1e1e1e', 
                  border: '1px solid #333',
                  borderRadius: '16px', 
                  padding: '16px', 
                  boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
                  width: 'calc(100% - 48px)',
                  maxWidth: '700px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  animation: 'slideUp 0.3s ease'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#9aa0a6' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>code</span>
                    Selected <span style={{ color: '#8ab4f8', fontWeight: 600 }}>&lt;{selectedElement.tag}&gt;</span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text"
                      autoFocus
                      placeholder="How should we change this section?"
                      value={refinementPrompt}
                      onChange={e => setRefinementPrompt(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRefine()}
                      style={{ 
                        flex: 1, 
                        background: '#2a2a2a', 
                        border: '1px solid #444', 
                        borderRadius: '8px', 
                        padding: '10px 16px', 
                        color: '#fff', 
                        fontSize: '14px',
                        outline: 'none'
                      }}
                    />
                    <button 
                      onClick={handleRefine}
                      style={{ 
                        background: '#8ab4f8', 
                        color: '#000', 
                        border: 'none', 
                        borderRadius: '8px', 
                        padding: '0 20px', 
                        fontWeight: 600, 
                        cursor: 'pointer' 
                      }}
                    >
                      Update
                    </button>
                    <button 
                      onClick={() => setSelectedElement(null)}
                      style={{ 
                        background: '#333', 
                        color: '#fff', 
                        border: 'none', 
                        borderRadius: '8px', 
                        padding: '0 12px', 
                        cursor: 'pointer' 
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ marginTop: '4px' }}>close</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Tap to Prompt Toggle Button */}
              {!activeTab.loading && !selectionMode && !selectedElement && (
                <button 
                  onClick={() => setSelectionMode(true)}
                  style={{ 
                    position: 'absolute', 
                    bottom: '24px', 
                    right: '24px', 
                    zIndex: 99, 
                    background: '#8ab4f8', 
                    color: '#000', 
                    width: '56px', 
                    height: '56px', 
                    borderRadius: '28px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    cursor: 'pointer',
                    border: 'none',
                    transition: 'all 0.2s ease'
                  }}
                  title="Tap to Prompt"
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <span className="material-symbols-outlined">touch_app</span>
                </button>
              )}
            </div>
          )}
        </div>
      </BrowserShell>
      <DisclaimerPopup />

      {/* Library Modal */}
      {showLibrary && (
        <div 
          onClick={() => setShowLibrary(false)}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0,0,0,0.85)', 
            zIndex: 10000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            backdropFilter: 'blur(5px)',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              width: '90%', 
              maxWidth: '800px', 
              maxHeight: '80vh', 
              background: '#1a1a1a', 
              border: '1px solid #333', 
              borderRadius: '24px', 
              display: 'flex', 
              flexDirection: 'column', 
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              animation: 'scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
            }}
          >
            <div style={{ padding: '24px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#202020' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="material-symbols-outlined" style={{ color: '#8ab4f8' }}>folder_special</span>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500, color: '#fff' }}>My Library</h2>
                <span style={{ background: '#333', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', color: '#9aa0a6' }}>{savedPages.length} pages</span>
              </div>
              <button 
                onClick={() => setShowLibrary(false)}
                style={{ background: '#333', border: 'none', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {savedPages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#5f6368' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '48px', marginBottom: '16px' }}>drafts</span>
                  <p>No saved pages yet.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
                  {savedPages.map(page => (
                    <div 
                      key={page.id} 
                      onClick={() => handleLoadSaved(page)}
                      style={{ 
                        background: '#252525', 
                        border: '1px solid #333', 
                        borderRadius: '16px', 
                        padding: '16px', 
                        cursor: 'pointer',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                      className="library-card"
                    >
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.sitename}</div>
                      <div style={{ fontSize: '13px', color: '#9aa0a6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.name}</div>
                      <div style={{ fontSize: '11px', color: '#5f6368', marginTop: '4px' }}>{new Date(page.timestamp).toLocaleDateString()}</div>
                      
                      <button 
                        onClick={(e) => handleDeleteSaved(page.id, e)}
                        className="delete-btn"
                        style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.3)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', color: '#f28b82', cursor: 'pointer', opacity: 0, transition: 'opacity 0.2s' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      <style>{`
        .library-card:hover {
          background: #2a2a2a !important;
          border-color: #8ab4f8 !important;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.3);
        }
        .library-card:hover .delete-btn {
          opacity: 1 !important;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        .rotating {
          animation: rotate 2s linear infinite;
        }
        @keyframes rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </OuterFrame>
  );
};

export default App;