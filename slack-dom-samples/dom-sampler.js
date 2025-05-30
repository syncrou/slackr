// DOM Sampler for Slack - Run this in browser console
// This will help capture different states of Slack for better selector development

class SlackDOMSampler {
  constructor() {
    this.samples = {};
  }

  // Capture current page state with a descriptive name
  capturePage(sampleName) {
    const sample = {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      title: document.title,
      html: document.documentElement.outerHTML,
      // Capture specific elements we care about
      elements: this.captureKeyElements()
    };
    
    this.samples[sampleName] = sample;
    console.log(`✅ Captured sample: ${sampleName}`);
    return sample;
  }

  // Capture specific elements we use for detection
  captureKeyElements() {
    const elements = {};
    
    // Message elements
    elements.messages = this.captureElements([
      '.c-message__body',
      '.p-rich_text_section',
      '[data-qa="message_content"]',
      '.c-message_kit__message'
    ]);

    // Sidebar elements
    elements.sidebar = this.captureElements([
      '.p-channel_sidebar',
      '[data-qa="channel_sidebar"]',
      '.p-channel_sidebar__channel'
    ]);

    // DM indicators
    elements.dmIndicators = this.captureElements([
      '.p-channel_sidebar__channel--im',
      '[data-qa="channel_header_channel_type_icon_dm"]'
    ]);

    // Mention indicators
    elements.mentionIndicators = this.captureElements([
      '[data-stringify-at-mention]',
      '.c-mention_badge',
      '.p-channel_sidebar__badge'
    ]);

    // User profile elements
    elements.userProfile = this.captureElements([
      '[data-qa="current-user-name"]',
      '[data-qa="name-in-profile-header"]',
      '.p-ia__nav__user__button',
      '[data-qa="global-nav-user-button"]'
    ]);

    return elements;
  }

  // Helper to capture elements with their HTML and attributes
  captureElements(selectors) {
    const captured = [];
    
    selectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el, index) => {
          captured.push({
            selector: selector,
            index: index,
            tagName: el.tagName,
            innerHTML: el.innerHTML,
            outerHTML: el.outerHTML,
            textContent: el.textContent,
            attributes: this.getElementAttributes(el),
            computedStyle: this.getRelevantStyles(el)
          });
        });
      } catch (error) {
        console.log(`Error with selector ${selector}:`, error);
      }
    });
    
    return captured;
  }

  // Get all attributes of an element
  getElementAttributes(element) {
    const attrs = {};
    Array.from(element.attributes).forEach(attr => {
      attrs[attr.name] = attr.value;
    });
    return attrs;
  }

  // Get relevant computed styles
  getRelevantStyles(element) {
    const style = window.getComputedStyle(element);
    return {
      fontWeight: style.fontWeight,
      color: style.color,
      backgroundColor: style.backgroundColor,
      display: style.display,
      visibility: style.visibility
    };
  }

  // Export all samples as JSON
  exportSamples() {
    const json = JSON.stringify(this.samples, null, 2);
    console.log('📁 DOM Samples JSON:');
    console.log(json);
    
    // Create downloadable file
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slack-dom-samples-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    return json;
  }

  // Quick capture of current state
  quickCapture() {
    const url = window.location.href;
    let sampleName = 'unknown';
    
    if (url.includes('/client/')) {
      const parts = url.split('/');
      const channelId = parts[parts.length - 1];
      
      if (channelId.startsWith('D')) {
        sampleName = 'dm-conversation';
      } else if (channelId.startsWith('C')) {
        sampleName = 'channel-conversation';
      } else if (channelId.startsWith('G')) {
        sampleName = 'group-conversation';
      }
    }
    
    return this.capturePage(sampleName + '-' + Date.now());
  }

  // Analyze current page for mentions and DMs
  analyzePage() {
    console.log('🔍 Analyzing current Slack page...');
    
    const analysis = {
      url: window.location.href,
      isDM: this.isDMPage(),
      mentions: this.findMentions(),
      messages: this.findMessages(),
      userElements: this.findUserElements()
    };
    
    console.log('📊 Analysis Results:', analysis);
    return analysis;
  }

  isDMPage() {
    return !!(
      document.querySelector('.p-channel_sidebar__channel--im.p-channel_sidebar__channel--selected') ||
      document.querySelector('[data-qa="channel_header_channel_type_icon_dm"]') ||
      (window.location.href.includes('/client/') && window.location.href.split('/').pop().startsWith('D'))
    );
  }

  findMentions() {
    const mentionSelectors = [
      '[data-stringify-at-mention]',
      '.c-mention_badge',
      '.p-channel_sidebar__badge'
    ];
    
    const mentions = [];
    mentionSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        mentions.push({
          selector: selector,
          text: el.textContent,
          html: el.outerHTML
        });
      });
    });
    
    return mentions;
  }

  findMessages() {
    const messageSelectors = [
      '.c-message__body',
      '.p-rich_text_section',
      '[data-qa="message_content"]'
    ];
    
    const messages = [];
    messageSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        messages.push({
          selector: selector,
          text: el.textContent.substring(0, 100),
          hasUserMention: el.textContent.includes('@') // Basic check
        });
      });
    });
    
    return messages;
  }

  findUserElements() {
    const userSelectors = [
      '[data-qa="current-user-name"]',
      '[data-qa="name-in-profile-header"]',
      '.p-ia__nav__user__button img[alt]'
    ];
    
    const userElements = [];
    userSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        userElements.push({
          selector: selector,
          text: el.textContent,
          alt: el.alt || '',
          title: el.title || ''
        });
      });
    });
    
    return userElements;
  }
}

// Create global instance
window.slackSampler = new SlackDOMSampler();

console.log(`
🚀 Slack DOM Sampler Loaded!

Usage:
  slackSampler.capturePage('my-sample-name')     - Capture current page
  slackSampler.quickCapture()                    - Auto-name based on page type
  slackSampler.analyzePage()                     - Analyze current page for mentions/DMs
  slackSampler.exportSamples()                   - Download all samples as JSON

Example workflow:
1. Navigate to a channel with mentions
2. slackSampler.capturePage('channel-with-mentions')
3. Navigate to a DM conversation
4. slackSampler.capturePage('dm-conversation')
5. slackSampler.exportSamples() - Download for analysis
`); 