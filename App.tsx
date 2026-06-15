import React, { useState, useCallback, useRef } from 'react';
import { OuterFrame } from './components/OuterFrame';
import { BrowserShell } from './components/BrowserShell';
import { Sandbox } from './components/Sandbox';
import { NewTab } from './components/NewTab';
import { DisclaimerPopup } from './components/DisclaimerPopup';
import { streamPageGeneration } from './services/geminiService';
import { Page, Breadcrumb, TokenCount, FormFieldState, GroundingSource, Tab, createTab } from './types';
import { siteNameFromPrompt, parsePageFromHref, extractTitleFromHtml } from './utils/urlHelpers';

const App: React.FC = () => {
  // Tab state
  const [tabs, setTabs] = useState<Tab[]>([createTab()]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // Global controls (shared across tabs)
  const [isGrounded, setIsGrounded] = useState(false);
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    return localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || '';
  });
  const [useCustomKey, setUseCustomKey] = useState<boolean>(() => {
    return localStorage.getItem('USE_CUSTOM_KEY') === 'true';
  });

  const handleSaveApiKey = useCallback((key: string) => {
    setUserApiKey(key);
    if (key) {
      localStorage.setItem('GEMINI_API_KEY_OVERRIDE', key);
    } else {
      localStorage.removeItem('GEMINI_API_KEY_OVERRIDE');
    }
  }, []);

  const handleToggleCustomKey = useCallback(() => {
    setUseCustomKey(prev => {
      const next = !prev;
      localStorage.setItem('USE_CUSTOM_KEY', String(next));
      return next;
    });
  }, []);

  // Abort controllers keyed by tab id
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const activeTab = tabs[activeTabIndex];
  const currentPage = activeTab.currentIndex >= 0 ? activeTab.history[activeTab.currentIndex] : null;

  // -- Helper to update the active tab immutably --
  const updateTab = useCallback((tabIndex: number, updater: (tab: Tab) => Tab) => {
    setTabs(prev => prev.map((t, i) => i === tabIndex ? updater(t) : t));
  }, []);

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
      loadingMessage: 'Streaming website from Gemini 3.1 Flash-Lite',
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

    try {
      console.log('Generating with prompt:', prompt);
      const stream = streamPageGeneration(
        prompt, 
        currentHtml, 
        isGrounded, 
        controller.signal, 
        formState, 
        window.innerWidth <= 768, 
        useCustomKey ? userApiKey : undefined,
        useCustomKey
      );

      for await (const chunk of stream) {
        if (controller.signal.aborted) break;

        // Live token count updates (estimated during streaming)
        if (chunk.startsWith('__TOKEN__')) {
          try {
            const tokenData = JSON.parse(chunk.replace('__TOKEN__', ''));
            updateTab(tabIndex, tab => ({ ...tab, tokenCount: tokenData }));
          } catch { }
          continue;
        }

        if (chunk.startsWith('__META__')) {
          try {
            const meta = JSON.parse(chunk.replace('__META__', ''));
            pageTokenCount = meta.tokenCount;
            // Update with confirmed (non-estimate) values
            updateTab(tabIndex, tab => ({ ...tab, tokenCount: pageTokenCount }));
            if (meta.groundingSources?.length) {
              pageGroundingSources = meta.groundingSources;
              updateTab(tabIndex, tab => ({ ...tab, groundingSources: meta.groundingSources }));
            }
            if (meta.searchEntryPointHtml) {
              pageSearchEntryPointHtml = meta.searchEntryPointHtml;
              updateTab(tabIndex, tab => ({ ...tab, searchEntryPointHtml: meta.searchEntryPointHtml }));
            }
          } catch { }
          continue;
        }
        fullHtml += chunk;

        const currentFullHtml = fullHtml;
        let extractedBreadcrumb: Breadcrumb | null = null;
        if (!titleExtracted && currentFullHtml.includes('</title>')) {
          extractedBreadcrumb = extractTitleFromHtml(currentFullHtml);
          if (extractedBreadcrumb) titleExtracted = true;
        }

        updateTab(tabIndex, tab => ({
          ...tab,
          generatedContent: currentFullHtml,
          loadingMessage: 'Streaming website from Gemini 3.1 Flash-Lite',
          ...(extractedBreadcrumb ? { breadcrumb: extractedBreadcrumb } : {}),
        }));
      }

      if (fullHtml.length === 0 && !controller.signal.aborted) {
        throw new Error("Gemini returned an empty response. This might be due to safety filters or a temporary connection issue. Try a more descriptive prompt.");
      }

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
      
      let displayErrorMessage = errorMessage;
      let isQuotaError = false;
      
      try {
        // Try parsing JSON error from Gemini
        if (errorMessage.startsWith('{')) {
          const parsed = JSON.parse(errorMessage);
          if (parsed.error?.message) {
            displayErrorMessage = parsed.error.message;
            if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
              isQuotaError = true;
            }
          }
        }
      } catch (e) { }

      if (!isQuotaError) {
        isQuotaError = displayErrorMessage.toLowerCase().includes('quota') || 
                       displayErrorMessage.toLowerCase().includes('exhausted') || 
                       displayErrorMessage.includes('429');
      }

      updateTab(tabIndex, tab => ({
        ...tab,
        breadcrumb: fallbackBreadcrumb,
        generatedContent: `<div style="padding: 40px; font-family: sans-serif; background: white; color: black;">
          <h1 style="color: #d32f2f; margin-bottom: 20px;">Generation Error</h1>
          <p style="font-size: 18px; margin-bottom: 20px;">${displayErrorMessage}</p>
          <div style="padding: 15px; background: #f5f5f5; border-radius: 8px; font-family: monospace; word-break: break-all; margin-bottom: 20px;">
            ${errorMessage}
          </div>
          <button onclick="window.location.reload()" style="padding: 12px 24px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer;">
            Refresh Page
          </button>
        </div>`,
      }));
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
  }, [isGrounded, activeTabIndex, tabs, updateTab, userApiKey]);

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

  const isNewTab = activeTab.history.length === 0 && !activeTab.loading && !activeTab.generatedContent;
  const displayContent = activeTab.loading ? activeTab.generatedContent : (currentPage?.html || activeTab.generatedContent || '');

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
        useCustomKey={useCustomKey}
        onToggleCustomKey={handleToggleCustomKey}
      >
        {isNewTab ? (
          <NewTab onCreatePage={handleCreate} />
        ) : (
          <Sandbox
            htmlContent={displayContent}
            onNavigate={handleLinkClick}
            onAction={handleAction}
          />
        )}
      </BrowserShell>
      <DisclaimerPopup />
    </OuterFrame>
  );
};

export default App;