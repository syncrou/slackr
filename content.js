// Content script that runs in the context of the Slack page

// Wrap everything in an IIFE to prevent multiple executions and make return legal
(function() {
  // Guard against multiple script injections
  if (window.slackMentionMonitorLoaded) {
    console.log("Slack Mention Monitor content script already loaded, skipping...");
    return;
  }
  window.slackMentionMonitorLoaded = true;

  // Store references to important elements
  let lastCheckedTimestamp = Date.now();
  let userName = ""; // Will be detected from the page
  let additionalUserNames = []; // Will be populated from detected username
  let userAvatar = ""; // Will store the user's avatar URL

  // Store workspace info
  let currentWorkspaceId = "";
  let currentChannelId = "";

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ping") {
      sendResponse({success: true, timestamp: Date.now()});
      return true;
    } else if (message.action === "checkMentions") {
      // Scan all channels for mentions - no response needed
      scanForMentions(true);
    } else if (message.action === "sendResponse") {
      // Send a response in Slack - no response to background script
      sendSlackResponse(message.threadId, message.responseText);
      // Do NOT return true here, as we're not sending an async response
      return false;
    } else if (message.action === "getDetectedUsername") {
      // Respond with username info
      sendResponse({
        userName: userName,
        additionalUserNames: additionalUserNames,
        userAvatar: userAvatar
      });
      // Return true to indicate we'll send a response asynchronously
      return true;
    } else if (message.action === "getWorkspaceInfo") {
      // Extract workspace/channel info from the URL and send it back
      const workspaceInfo = extractWorkspaceInfo();
      sendResponse(workspaceInfo);
      // Return true to indicate we'll send a response asynchronously
      return true;
    } else if (message.action === "checkSlackLoginStatus") {
      // Check if we're on the login page
      const isLoginPage = document.querySelector('h1') && 
                          (document.querySelector('h1').textContent.includes('Sign in to your workspace') ||
                           document.querySelector('input[placeholder="your-workspace"]') !== null);
      
      sendResponse({
        isLoginPage: isLoginPage
      });
      // Return true to indicate we'll send a response asynchronously
      return true;
    }
    // Default: no response sent
    return false;
  });

  // Function to extract workspace and channel IDs from the URL
  function extractWorkspaceInfo() {
    const url = window.location.href;
    const urlMatch = url.match(/\/client\/([^\/]+)\/([^\/]+)/);
    
    if (urlMatch && urlMatch[1] && urlMatch[2]) {
      const extractedWorkspaceId = urlMatch[1];
      const extractedChannelId = urlMatch[2];
      
      // Only update if different from current values
      if (extractedWorkspaceId !== currentWorkspaceId || 
          extractedChannelId !== currentChannelId) {
        
        currentWorkspaceId = extractedWorkspaceId;
        currentChannelId = extractedChannelId;
        
        console.log(`Updated workspace info: ${currentWorkspaceId}/${currentChannelId}`);
        
        // Send the updated info to the background script
        chrome.runtime.sendMessage({
          action: "workspaceInfoUpdate",
          workspaceId: currentWorkspaceId,
          channelId: currentChannelId
        });
      }
      
      return {
        workspaceId: currentWorkspaceId,
        channelId: currentChannelId
      };
    }
    
    return {
      workspaceId: "",
      channelId: ""
    };
  }

  // Function to detect the current user's information
  function detectCurrentUser() {
    try {
      // Look for the current user's profile button with data-qa-presence-self="true"
      const userButton = document.querySelector('[data-qa-presence-self="true"]');
      if (userButton) {
        // Get the parent button element which has the aria-label
        const parentButton = userButton.closest('button[aria-label]');
        if (parentButton) {
          const ariaLabel = parentButton.getAttribute('aria-label');
          // Extract username from "User: Drew Bomhof" format
          if (ariaLabel && ariaLabel.startsWith('User: ')) {
            const fullName = ariaLabel.replace('User: ', '');
            // For mentions, we typically need the first name or a shortened version
            const firstName = fullName.split(' ')[0].toLowerCase();
            userName = firstName;
            
            // Also try to get avatar
            const avatarImg = parentButton.querySelector('img[src*="slack-edge.com"]');
            if (avatarImg) {
              userAvatar = avatarImg.src;
            }
            
            console.log('Detected current user:', userName, 'Avatar:', userAvatar);
            
            // Generate additional username variations
            additionalUserNames = [
              userName,
              fullName.toLowerCase(),
              fullName.toLowerCase().replace(/\s+/g, ''),
              fullName.toLowerCase().replace(/\s+/g, '.'),
              fullName.toLowerCase().replace(/\s+/g, '-'),
              fullName.toLowerCase().replace(/\s+/g, '_')
            ];
            
            return true;
          }
        }
      }
      
      // Fallback: try to extract from URL or other methods
      const urlMatch = window.location.href.match(/\/client\/([^\/]+)/);
      if (urlMatch) {
        currentWorkspaceId = urlMatch[1];
      }
      
      return false;
    } catch (error) {
      console.error('Error detecting current user:', error);
      return false;
    }
  }

  // Function to scan all channels for mentions and unread indicators
  function scanForMentions(manualCheck = false) {
    try {
      // Detect current user if not already done
      if (!userName) {
        detectCurrentUser();
      }
      
      // Force Slack to update its notification state if tab is not visible
      forceSlackRefresh();
      
      const mentions = [];
      const directMessages = [];
      
      // Look for all channel items in the sidebar
      const channelItems = document.querySelectorAll('[data-qa="virtual-list-item"]');
      
      channelItems.forEach(item => {
        try {
          const channelElement = item.querySelector('[data-qa="channel-sidebar-channel"]');
          if (!channelElement) return;
          
          const channelId = channelElement.getAttribute('data-qa-channel-sidebar-channel-id');
          const channelType = channelElement.getAttribute('data-qa-channel-sidebar-channel-type');
          const channelName = getChannelName(channelElement);
          
          if (!channelId || !channelName) return;
          
          // Check for mention badges (red badges indicating @mentions)
          const mentionBadge = item.querySelector('.p-channel_sidebar__badge--mention, .p-channel_sidebar__badge--urgent, [data-qa*="mention"]');
          
          if (mentionBadge) {
            const badgeText = mentionBadge.textContent?.trim();
            const mentionCount = badgeText && !isNaN(badgeText) ? parseInt(badgeText) : 1;
            
            mentions.push({
              channelId,
              channelName,
              channelType,
              mentionCount,
              timestamp: Date.now(),
              isManual: manualCheck
            });
          }
          
          // Check for DM indicators (for direct messages)
          if (channelType === 'im' || channelType === 'mpim') {
            // Look for unread indicators in DMs
            const unreadIndicator = item.querySelector('.p-channel_sidebar__badge, .p-channel_sidebar__channel--unread, [data-qa*="unread"]');
            
            if (unreadIndicator && !mentionBadge) { // Don't double-count if it's already a mention
              directMessages.push({
                channelId,
                channelName,
                channelType,
                timestamp: Date.now(),
                isManual: manualCheck
              });
            }
          }
        } catch (error) {
          console.error('Error processing channel item:', error);
        }
      });
      
      // Send results to background script
      if (mentions.length > 0 || directMessages.length > 0) {
        chrome.runtime.sendMessage({
          action: "mentionsFound",
          mentions,
          directMessages,
          userName,
          userAvatar,
          timestamp: Date.now()
        }).catch(error => {
          console.error('Error sending mentions to background:', error);
        });
      } else if (manualCheck) {
        // Send empty results for manual checks to update the popup
        chrome.runtime.sendMessage({
          action: "mentionsFound",
          mentions: [],
          directMessages: [],
          userName,
          userAvatar,
          timestamp: Date.now()
        }).catch(error => {
          console.error('Error sending empty results to background:', error);
        });
      }
      
      lastCheckedTimestamp = Date.now();
      
    } catch (error) {
      console.error('Error in scanForMentions:', error);
    }
  }

  // Function to force Slack to refresh its notification state
  function forceSlackRefresh() {
    try {
      // Only do this for background checks, not manual ones
      if (document.hidden) {
        console.log('Tab is hidden, triggering Slack refresh...');
        
        // Method 1: Dispatch visibility change events
        document.dispatchEvent(new Event('visibilitychange'));
        
        // Method 2: Trigger focus events on the window
        window.dispatchEvent(new Event('focus'));
        
        // Method 3: Simulate user activity to wake up Slack
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window
        }));
        
        // Method 4: Check if Slack has a refresh API we can trigger
        const slackApp = window.TS || window.slack;
        if (slackApp && slackApp.client && slackApp.client.refreshData) {
          console.log('Triggering Slack client refresh...');
          slackApp.client.refreshData();
        }
        
        // Wait a moment for Slack to process the refresh
        return new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.log('Error in forceSlackRefresh:', error);
    }
    
    return Promise.resolve();
  }

  // Helper function to extract channel name
  function getChannelName(channelElement) {
    try {
      // Try different selectors for channel names
      const nameSelectors = [
        '[data-qa*="channel_sidebar_name"]',
        '.p-channel_sidebar__name',
        '.p-channel_sidebar__name span'
      ];
      
      for (const selector of nameSelectors) {
        const nameElement = channelElement.querySelector(selector);
        if (nameElement) {
          return nameElement.textContent?.trim();
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting channel name:', error);
      return null;
    }
  }

  // Initialize when the page loads
  function initialize() {
    console.log('Slack mention detector initialized');
    
    // Detect current user immediately
    detectCurrentUser();
    
    // Initial scan
    setTimeout(() => {
      scanForMentions();
    }, 2000);
    
    // Set up periodic scanning every 30 seconds
    setInterval(() => {
      scanForMentions();
    }, 30000);
    
    // Watch for DOM changes to detect new mentions
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      
      mutations.forEach((mutation) => {
        // Check if sidebar or badge elements changed
        if (mutation.target.closest && (
          mutation.target.closest('[data-qa="virtual-list-item"]') ||
          mutation.target.closest('.p-channel_sidebar') ||
          mutation.addedNodes.length > 0
        )) {
          shouldScan = true;
        }
      });
      
      if (shouldScan) {
        // Debounce the scanning
        clearTimeout(window.mentionScanTimeout);
        window.mentionScanTimeout = setTimeout(() => {
          scanForMentions();
        }, 1000);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-qa']
    });
  }

  // Wait for the page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  // Function to send a response in Slack
  function sendSlackResponse(threadId, text) {
    // Find the appropriate input field
    let inputField;
    
    // If it's a thread, we need to find the thread input
    const threadInput = document.querySelector('.p-threads_flexpane .ql-editor');
    if (threadInput) {
      inputField = threadInput;
    } else {
      // Otherwise use the main channel input
      inputField = document.querySelector('.p-message_input .ql-editor');
    }
    
    if (inputField) {
      // Set the text in the input field
      inputField.innerHTML = text;
      inputField.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Find and click the send button
      setTimeout(() => {
        const sendButton = document.querySelector('button[data-qa="texty_send_button"]');
        if (sendButton) {
          sendButton.click();
        }
      }, 500);
    }
  }

  // Set up URL change listener for single-page app
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('URL changed to', url);
      
      // Extract workspace info on URL change
      extractWorkspaceInfo();
      
      // Scan all channels when URL changes (user navigated to different channel)
      if (url.includes('/client/')) {
        console.log("Detected Slack client URL change, scanning all channels");
        scanForMentions(); // Scan all channels on navigation
      }
    }
  }).observe(document, {subtree: true, childList: true});

  // Log that the content script has loaded
  console.log("🚀 Slack Mention Monitor content script loaded at", new Date().toLocaleTimeString());
  console.log("📋 Extension configured for mentions and DMs only");
  console.log("🔍 Improved mention detection using DOM samples data");
  console.log("🌐 Now scanning ALL channels in workspace, not just current channel");

})(); // End of IIFE
