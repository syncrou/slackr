# Slack DOM Sampling Guide

This directory contains tools and samples for analyzing Slack's DOM structure to improve mention and DM detection.

## 🎯 Purpose

Slack's DOM structure is complex and changes frequently. By saving real DOM samples, we can:

- **Test selectors offline** without needing live Slack sessions
- **Develop more robust detection** by seeing actual HTML structure
- **Create fallback selectors** for when Slack updates their UI
- **Debug detection issues** with real examples

## 🚀 How to Use the DOM Sampler

### Step 1: Load the Sampler
1. Open Slack in your browser
2. Open Developer Tools (F12)
3. Go to Console tab
4. Copy and paste the contents of `dom-sampler.js`
5. The sampler will be available as `window.slackSampler`

### Step 2: Capture Different States
Navigate to different Slack pages and capture them:

```javascript
// In a channel with mentions
slackSampler.capturePage('channel-with-mentions')

// In a DM conversation
slackSampler.capturePage('dm-conversation')

// In the main channel list
slackSampler.capturePage('channel-list')

// Quick capture (auto-detects page type)
slackSampler.quickCapture()
```

### Step 3: Analyze Current Page
```javascript
// Get analysis of current page
slackSampler.analyzePage()

// This will show:
// - Whether it's a DM page
// - Found mentions
// - Available messages
// - User profile elements
```

### Step 4: Export Samples
```javascript
// Download all captured samples as JSON
slackSampler.exportSamples()
```

## 📁 Sample Types to Capture

### Essential Samples:
1. **`channel-with-mentions`** - Channel where you're mentioned
2. **`dm-conversation`** - Direct message thread
3. **`dm-list`** - Sidebar showing DM channels
4. **`channel-list`** - Sidebar showing all channels
5. **`slackbot-dm`** - DM with Slackbot
6. **`group-dm`** - Group direct message
7. **`thread-mention`** - Mention in a thread
8. **`user-profile-open`** - When user menu is open

### Advanced Samples:
9. **`mobile-view`** - Slack in mobile/narrow view
10. **`dark-mode`** - Slack in dark theme
11. **`different-workspace`** - Different workspace layout
12. **`no-mentions`** - Clean state with no notifications

## 🔍 Key Elements to Focus On

### Message Detection:
```css
.c-message__body          /* Main message content */
.p-rich_text_section      /* Rich text messages */
[data-qa="message_content"] /* Message containers */
```

### Mention Detection:
```css
[data-stringify-at-mention] /* @mention tags */
.c-mention_badge           /* Mention badges */
```

### DM Detection:
```css
.p-channel_sidebar__channel--im  /* DM channel in sidebar */
[data-qa="channel_header_channel_type_icon_dm"] /* DM icon */
```

### User Detection:
```css
[data-qa="current-user-name"]    /* Current user name */
[data-qa="global-nav-user-button"] /* User button */
```

## 🛠 Using Samples for Development

### 1. Offline Testing
Save the HTML to local files and test selectors:

```javascript
// Test if selector works on saved HTML
document.querySelector('.c-message__body')
```

### 2. Selector Validation
Compare multiple samples to find consistent selectors:

```javascript
// Check which selectors work across different samples
const selectors = ['.c-message__body', '.p-rich_text_section'];
selectors.forEach(sel => {
  console.log(`${sel}: ${document.querySelectorAll(sel).length} found`);
});
```

### 3. Fallback Development
Create multiple selectors for the same element type:

```javascript
const messageSelectors = [
  '.c-message__body',           // Primary
  '.p-rich_text_section',       // Fallback 1
  '[data-qa="message_content"]' // Fallback 2
];
```

## 📊 Sample Analysis

After capturing samples, analyze them to improve the extension:

1. **Compare DOM structures** across different page types
2. **Identify stable vs. changing elements**
3. **Find new selectors** that work better
4. **Test edge cases** (empty states, loading states)

## 🔄 Regular Updates

Slack updates their UI frequently, so:

- **Recapture samples monthly** or when UI changes
- **Test existing selectors** against new samples
- **Update the extension** with improved selectors

## 🎯 Integration with Extension

Use the insights from DOM samples to:

1. **Update `content.js`** with better selectors
2. **Add fallback methods** for detection
3. **Improve username detection** with new patterns
4. **Handle edge cases** found in samples

This systematic approach will make the extension much more reliable! 🚀 