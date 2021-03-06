import Domain from './domain';
import {Filter} from './lib/filter';
import Page from './page';
import WebAudio from './webAudio';
import Config from './lib/config';
import './vendor/findAndReplaceDOMText';

// NO-OP for chrome.* API
var chrome = {} as any;
chrome.runtime = {};
chrome.runtime.sendMessage = function(obj){};

/* @preserve - Start User Config */
var config = Config._defaults as any;
config.words = Config._defaultWords;
/* @preserve - End User Config */

export default class BookmarkletFilter extends Filter {
  advanced: boolean;
  cfg: Config;
  hostname: string;
  mutePage: boolean;
  lastSubtitle: string;
  muted: boolean;
  subtitleSelector: string;
  summary: object;
  volume: number;

  constructor() {
    super();
    this.advanced = false;
    this.muted = false;
    this.summary = {};
    this.volume = 1;
  }

  // Always use the top frame for page check
  advancedPage(): boolean {
    return Domain.domainMatch(this.hostname, this.cfg.advancedDomains);
  }

  advancedReplaceText(node) {
    filter.wordRegExps.forEach((regExp) => {
      // @ts-ignore - External library function
      findAndReplaceDOMText(node, {preset: 'prose', find: regExp, replace: function(portion, match) {
        return filter.replaceText(match[0]);
      }});
    });
  }

  checkMutationForProfanity(mutation) {
    mutation.addedNodes.forEach(node => {
      if (!Page.isForbiddenNode(node)) {
        if (filter.mutePage && WebAudio.youTubeAutoSubsPresent(filter)) { // YouTube Auto subs
          if (WebAudio.youTubeAutoSubsSupportedNode(filter.hostname, node)) {
            WebAudio.cleanYouTubeAutoSubs(filter, node); // Clean Auto subs
          } else if (!WebAudio.youTubeAutoSubsNodeIsSubtitleText(node)) {
            filter.cleanNode(node); // Clean the rest of the page
          }
        } else if (filter.mutePage && WebAudio.supportedNode(filter.hostname, node)) {
          WebAudio.clean(filter, node, filter.subtitleSelector);
        } else {
          if (filter.advanced && node.parentNode) {
            filter.advancedReplaceText(node);
          } else {
            filter.cleanNode(node);
          }
        }
      }
    });

    mutation.removedNodes.forEach(node => {
      if (filter.mutePage && WebAudio.supportedNode(filter.hostname, node)) {
        WebAudio.unmute(filter);
      }
    });

    // Only process mutation change if target is text
    if (mutation.target && mutation.target.nodeName == '#text') {
      filter.checkMutationTargetTextForProfanity(mutation);
    }
  }

  checkMutationTargetTextForProfanity(mutation) {
    if (!Page.isForbiddenNode(mutation.target)) {
      let result = this.replaceTextResult(mutation.target.data);
      if (result.modified) {
        mutation.target.data = result.filtered;
      }
    }
  }

  cleanNode(node) {
    if (Page.isForbiddenNode(node)) { return false; }

    if (node.childElementCount > 0) { // Tree node
      let treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while(treeWalker.nextNode()) {
        if (treeWalker.currentNode.childNodes.length > 0) {
          treeWalker.currentNode.childNodes.forEach(childNode => {
            this.cleanNode(childNode);
          });
        } else {
          this.cleanNode(treeWalker.currentNode);
        }
      }
    } else { // Leaf node
      if (node.nodeName) {
        if (node.textContent.trim() != '') {
          let result = this.replaceTextResult(node.textContent);
          if (result.modified) {
            node.textContent = result.filtered;
          }
        }
      }
    }
  }

  cleanPage() {
    this.cfg = new Config(config);
    this.cfg.muteMethod = 1; // Bookmarklet: Force audio muteMethod = 1 (Volume)

    // The hostname should resolve to the browser window's URI (or the parent of an IFRAME) for disabled/advanced page checks
    this.hostname = (window.location == window.parent.location) ? document.location.hostname : new URL(document.referrer).hostname;

    // Check if the topmost frame is a disabled domain
    if (this.disabledPage()) {
      return false;
    }

    // Check for advanced mode on current domain
    this.advanced = this.advancedPage();

    // Detect if we should mute audio for the current page
    this.mutePage = (this.cfg.muteAudio && Domain.domainMatch(this.hostname, WebAudio.supportedPages()));
    if (this.mutePage) { this.subtitleSelector = WebAudio.subtitleSelector(this.hostname); }

    // Remove profanity from the main document and watch for new nodes
    this.init();
    this.advanced ? this.advancedReplaceText(document) : this.cleanNode(document);
    this.observeNewNodes();
  }

  // Always use the top frame for page check
  disabledPage(): boolean {
    return Domain.domainMatch(this.hostname, this.cfg.disabledDomains);
  }

  observeNewNodes() {
    let self = this;
    let observerConfig = {
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    };

    // When DOM is modified, check for nodes to filter
    let observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        self.checkMutationForProfanity(mutation);
      });
    });

    observer.observe(document, observerConfig);
  }

  replaceTextResult(string: string, stats: boolean = true) {
    let result = {} as any;
    result.original = string;
    result.filtered = filter.replaceText(string);
    result.modified = (result.filtered != string);
    return result;
  }

  updateCounterBadge() {} // NO-OP
}

var filter = new BookmarkletFilter;
if (typeof window !== 'undefined') {
  filter.cleanPage();
}