# Slack Mention Monitor

A Chrome extension that monitors Slack for mentions and provides AI-powered suggested responses.

## Features

- **Real-time mention detection** in Slack channels and direct messages
- **Channel activity monitoring** for unread messages and highlights
- **AI-powered response suggestions** using OpenAI, Claude, or Gemini
- **Background monitoring** that works even when the popup is closed
- **System notifications** for new mentions and activity
- **Configurable Slack workspace/channel** monitoring
- **Username auto-detection** with manual fallback option

## Background Monitoring

The extension now includes robust background monitoring that:

- ✅ **Runs continuously** even when popup is closed or you switch tabs
- ✅ **Checks every 2 minutes** via Chrome alarms API
- ✅ **Monitors tab activation** for immediate checks when Slack becomes active
- ✅ **Shows badge count** on extension icon for unread mentions
- ✅ **Provides status indicator** in popup to show monitoring health
- ✅ **Auto-recovers** from service worker suspension
- ✅ **Heartbeat logging** to ensure content scripts stay active

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your Chrome toolbar

## Setup

1. **Configure Slack URL**: Open the extension popup and go to Settings → Slack Configuration
2. **Set AI Provider**: Choose between OpenAI, Claude, or Gemini in Settings → AI Integration
3. **Username Detection**: The extension will automatically detect your Slack username

## Usage

### Automatic Monitoring
- The extension automatically monitors your configured Slack channel
- Background checks occur every 2 minutes
- Immediate checks when you switch to Slack tabs
- System notifications appear for new mentions

### Manual Checking
- Click "Check for Mentions Now" for immediate scanning
- View mentions categorized as:
  - 🔔 **Direct Mentions** (red border)
  - 💬 **Direct Messages** (blue border)
  - 📢 **Channel Activity** (green border)

### Debugging
- **Background Status**: Check the status indicator in the popup
- **Console Debugging**: Run `window.debugBackgroundActivity()` in popup console
- **Channel Detection**: Run `window.debugSlackChannels()` in Slack tab console

## Troubleshooting

### Background Monitoring Not Working
1. Check the status indicator in the popup
2. If inactive, try reloading the extension
3. Ensure Slack tabs are open
4. Check Chrome's extension management page for errors

### No Mentions Detected
1. Verify your Slack URL is configured correctly
2. Ensure you're signed into Slack
3. Check that your username was detected properly
4. Use the debug functions to inspect detection

### Service Worker Issues
- The extension automatically recovers from Chrome service worker suspension
- Alarms are recreated if lost
- Heartbeat logging ensures continuous operation

## Permissions

- `tabs`: Access to Slack and Gemini tabs
- `storage`: Store mentions and settings
- `alarms`: Background periodic checking
- `notifications`: System notifications for mentions

## AI Integration

### Gemini (Browser-based)
- Uses Gemini web interface in another tab
- No API key required
- Real-time response generation

### OpenAI/Claude (API-based)
- Requires API key configuration
- Generates contextual responses
- Fallback to default responses if API fails

## Files

- `manifest.json` - Extension manifest
- `popup.html` - Extension popup interface with notices system
- `popup.js` - Popup functionality and settings management
- `background.js` - Background service worker for periodic checking
- `content.js` - Content script for Slack page interaction
- `gemini-content.js` - Content script for Gemini integration

## Privacy

- All data is stored locally in Chrome's storage
- API keys are stored securely in local storage
- No data is sent to external servers except for AI response generation
- Username detection is performed locally without external requests 