export interface Breadcrumb {
  sitename: string;
  page: string;
}

export interface TokenCount {
  input: number;
  output: number;
  isEstimate?: boolean;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface Page {
  html: string;
  breadcrumb: Breadcrumb;
  scrollPosition: number;
  timestamp: number;
  tokenCount: TokenCount;
  prompt: string;
  contextHtml: string | null;
  isGrounded: boolean;
  groundingSources: GroundingSource[];
  searchEntryPointHtml: string;
}

export interface FormFieldState {
  name: string;
  type: string;
  value: string;
}

export interface Tab {
  id: string;
  history: Page[];
  currentIndex: number;
  loading: boolean;
  loadingMessage: string;
  generatedContent: string;
  breadcrumb: Breadcrumb;
  tokenCount: TokenCount | null;
  groundingSources: GroundingSource[];
  searchEntryPointHtml: string;
  navigationId: number;
}

let nextTabId = 0;

export function createTab(): Tab {
  return {
    id: `tab-${nextTabId++}`,
    history: [],
    currentIndex: -1,
    loading: false,
    loadingMessage: '',
    generatedContent: '',
    breadcrumb: { sitename: '', page: '' },
    tokenCount: null,
    groundingSources: [],
    searchEntryPointHtml: '',
    navigationId: 0,
  };
}