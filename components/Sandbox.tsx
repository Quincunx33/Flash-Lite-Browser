import React, { useRef, useEffect } from 'react';
import { FormFieldState } from '../types';

interface SandboxProps {
  htmlContent: string;
  onNavigate: (href: string, linkText: string, formState?: FormFieldState[]) => void;
  onAction: (intent: string, payload?: string, formState?: FormFieldState[]) => void;
}

// Static shell HTML loaded via srcdoc — runs in an opaque origin (no allow-same-origin).
// Content updates are received via postMessage, not contentDocument injection.
const SHELL_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'; frame-src 'none';">
    <script src="https://cdn.tailwindcss.com"></script>
    <script id="flash-lite-api">
      // Capture current form field state
      function getFormState() {
        const fields = [];
        const inputs = document.querySelectorAll('input, textarea, select');
        inputs.forEach(el => {
          const name = el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || '';
          const type = el.tagName.toLowerCase() === 'select' ? 'select'
            : el.tagName.toLowerCase() === 'textarea' ? 'textarea'
            : (el.getAttribute('type') || 'text');
          let value = '';
          if (el.tagName.toLowerCase() === 'select') {
            value = el.options[el.selectedIndex]?.text || el.value;
          } else if (type === 'checkbox' || type === 'radio') {
            value = el.checked ? 'checked' : 'unchecked';
          } else {
            value = el.value;
          }
          if (value && value !== 'unchecked') {
            fields.push({ name, type, value });
          }
        });
        return fields;
      }

      window.FlashLiteAPI = {
        navigate: (url, text) => {
          const formState = getFormState();
          window.parent.postMessage({ type: 'NAVIGATE', url, text, formState }, '*');
        },
        performAction: (intent, payload) => {
          const formState = getFormState();
          window.parent.postMessage({ type: 'ACTION', intent, payload, formState }, '*');
        }
      };

      // Disable autocomplete on all form fields
      function disableAutocomplete(root) {
        root.querySelectorAll('input, textarea, select').forEach(el => {
          el.setAttribute('autocomplete', 'off');
        });
      }
      // Watch for dynamically added inputs
      new MutationObserver((mutations) => {
        mutations.forEach(m => m.addedNodes.forEach(node => {
          if (node.nodeType === 1) disableAutocomplete(node.parentElement || node);
        }));
      }).observe(document.documentElement, { childList: true, subtree: true });

      // Intercept links
      document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && !link.onclick && !link.getAttribute('onclick')) {
          e.preventDefault();
          const href = link.getAttribute('href') || '';
          const text = link.innerText || href;
          FlashLiteAPI.navigate(href, text);
        }
      });

      // Hide broken Material Symbols icons.
      // Valid icon ligatures are roughly square (width ≈ height).
      // Broken ones render as text, so width >> height.
      function hideBrokenIcons() {
        document.querySelectorAll(
          '.material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, '
          + '.material-icons, .material-icons-outlined, .material-icons-round, .material-icons-sharp, .material-icons-two-tone'
        ).forEach(el => {
          if (el.offsetWidth > el.offsetHeight * 1.5) {
            el.style.display = 'none';
          }
        });
      }

      // Listen for content updates from parent
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'CONTENT_UPDATE') {
          document.body.innerHTML = e.data.html;
          document.body.className = 'min-h-screen ' + (e.data.bodyClasses || '');
          document.body.setAttribute('style', e.data.bodyStyle || '');
          document.documentElement.style.colorScheme = e.data.colorScheme || 'light';

          // Inject font links (only pre-validated Google Fonts hrefs)
          document.head.querySelectorAll('link[data-flash-lite-font]').forEach(el => el.remove());
          (e.data.linkTags || []).forEach(href => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.setAttribute('data-flash-lite-font', 'true');
            document.head.appendChild(link);
          });

          // After content + fonts are ready, hide any broken icon ligatures
          document.fonts.ready.then(() => hideBrokenIcons());
        }
      });

      // Signal ready to parent
      window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
    </script>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
    <style>
      /* Override Tailwind's default ui-sans-serif with a more neutral stack */
      html { font-family: Helvetica, Arial, sans-serif; }
      body { -webkit-font-smoothing: antialiased; }
      input, textarea, select, button { color: inherit; }
      ::placeholder { opacity: 0.5; }

      /* Handle all Material Icon class variants the model might use */
      .material-symbols-outlined,
      .material-symbols-rounded,
      .material-symbols-sharp,
      .material-icons,
      .material-icons-outlined,
      .material-icons-round,
      .material-icons-sharp,
      .material-icons-two-tone {
        font-family: 'Material Symbols Outlined';
        font-weight: normal;
        font-style: normal;
        font-size: 24px;
        line-height: 1;
        letter-spacing: normal;
        text-transform: none;
        display: inline-block;
        white-space: nowrap;
        word-wrap: normal;
        direction: ltr;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        font-feature-settings: 'liga';
      }
    </style>
  </head>
  <body class="min-h-screen" style="background-color: #111;"></body>
</html>`;

export const Sandbox: React.FC<SandboxProps> = ({ htmlContent, onNavigate, onAction }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeReadyRef = useRef(false);
  const pendingContentRef = useRef<any>(null);

  // Send content update to iframe via postMessage
  const sendContentUpdate = (message: any) => {
    if (iframeReadyRef.current && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(message, '*');
    } else {
      pendingContentRef.current = message;
    }
  };

  // Stream Content Updates
  useEffect(() => {
    if (!htmlContent) return;

    let cleanContent = htmlContent;

    // Detect color scheme from meta tag before stripping head
    const isDark = /<meta\s+name=["']color-scheme["']\s+content=["']dark["']/i.test(htmlContent);

    // Extract <link> tags from <head> — only allow Google Fonts URLs
    const headMatch = htmlContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const fontHrefs: string[] = [];
    if (headMatch) {
      const linkMatches = headMatch[1].match(/<link[^>]*>/gi);
      if (linkMatches) {
        linkMatches.forEach(tag => {
          const hrefMatch = tag.match(/href="([^"]+)"/i) || tag.match(/href='([^']+)'/i);
          if (hrefMatch) {
            const href = hrefMatch[1];
            // Only allow Google Fonts — block all other external stylesheets
            if (href.startsWith('https://fonts.googleapis.com/')) {
              fontHrefs.push(href);
            }
          }
        });
      }
    }

    // Extract body class attribute (for Tailwind classes)
    const bodyClassMatch = htmlContent.match(/<body[^>]*class="([^"]*)"/i) || htmlContent.match(/<body[^>]*class='([^']*)'/i);
    const bodyClasses = bodyClassMatch ? bodyClassMatch[1] : '';

    // Extract body inline style (for font-family etc.)
    const bodyStyleMatch = htmlContent.match(/<body[^>]*style="([^"]*)"/i) || htmlContent.match(/<body[^>]*style='([^']*)'/i);
    const bodyInlineStyle = bodyStyleMatch ? bodyStyleMatch[1] : '';

    // Extract just the body content from a full HTML document
    const bodyMatch = cleanContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      cleanContent = bodyMatch[1];
    } else {
      // Fallback: strip any stray tags from fragment-style output
      cleanContent = cleanContent
        .replace(/<\/?html[^>]*>/gi, '')
        .replace(/<head>[\s\S]*?<\/head>/gi, '')
        .replace(/<title>[^<]*<\/title>/gi, '')
        .replace(/<meta[^>]*>/gi, '')
        .replace(/<\/?body[^>]*>/gi, '');
    }

    sendContentUpdate({
      type: 'CONTENT_UPDATE',
      html: cleanContent,
      bodyClasses,
      bodyStyle: `background-color: ${isDark ? '#111' : '#fff'}; color: ${isDark ? '#e8eaed' : '#1a1a1a'}; ${bodyInlineStyle}`,
      colorScheme: isDark ? 'dark' : 'light',
      linkTags: fontHrefs,
    });

    // Update the iframe element's own background to match (prevents white flash)
    if (iframeRef.current) {
      iframeRef.current.style.background = isDark ? '#111' : '#fff';
    }
  }, [htmlContent]);

  // Handle Messages from iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (event.source !== iframeRef.current?.contentWindow) return;

      if (event.data?.type === 'SANDBOX_READY') {
        iframeReadyRef.current = true;
        if (pendingContentRef.current) {
          iframeRef.current?.contentWindow?.postMessage(pendingContentRef.current, '*');
          pendingContentRef.current = null;
        }
        return;
      }

      if (event.data?.type === 'NAVIGATE') {
        const href = event.data.url || '';
        const linkText = event.data.text || href || 'Navigate';
        const formState = event.data.formState;
        onNavigate(href, linkText, formState);
      }
      if (event.data?.type === 'ACTION') {
        onAction(event.data.intent, event.data.payload, event.data.formState);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onNavigate, onAction]);

  return (
    <iframe
      ref={iframeRef}
      className="sandbox-iframe"
      srcDoc={SHELL_HTML}
      sandbox="allow-scripts allow-forms"
    />
  );
};