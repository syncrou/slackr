// Content script that runs in the context of the Slack page

// Store references to important elements
let lastCheckedTimestamp = Date.now();
let userName = ""; // Will be detected from the page
let additionalUserNames = []; // Will be populated from detected username

// Store workspace info
let currentWorkspaceId = "";
let currentChannelId = "";

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({success: true, timestamp: Date.now()});
    return true;
  } else if (message.action === "checkMentions") {
    // Just scan for mentions - no response needed
    scanForMentions(true); // Pass true to indicate this is a manual check
    // Do NOT return true here, as we're not sending an async response
    return false;
  } else if (message.action === "sendResponse") {
    // Send a response in Slack - no response to background script
    sendSlackResponse(message.threadId, message.responseText);
    // Do NOT return true here, as we're not sending an async response
    return false;
  } else if (message.action === "getDetectedUsername") {
    // Respond with username info
    sendResponse({
      userName: userName,
      additionalUserNames: additionalUserNames
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

// Function to detect the current user from the Slack UI
function detectCurrentUser() {
  // Check if we're on the login page
  const isLoginPage = document.querySelector('h1') && 
                      (document.querySelector('h1').textContent.includes('Sign in to your workspace') ||
                       document.querySelector('input[placeholder="your-workspace"]') !== null);
  
  if (isLoginPage) {
    console.log("On Slack login page - cannot detect username yet");
    return false;
  }
  
  // Check if we're in a Slack client by URL
  if (window.location.href.includes('/client/')) {
    // Extract workspace info if not already done
    if (!currentWorkspaceId) {
      extractWorkspaceInfo();
    }
    
    // If in a Slack client but can't detect username, use fallback
    const fallback = checkForUsernameInPage();
    if (fallback) {
      return true;
    }
  }
  
  // Try different selectors that might contain the username, ordered by reliability
  const userSelectors = [
    // Data-qa attributes and contemporary selectors
    '[data-qa="current-user-name"]',
    '[data-qa="name-in-profile-header"]',
    '[data-qa="global-nav-user-button"] img[alt]', // User icon with alt text
    '[data-qa="user-profile-header-username"]',
    
    // Class-based selectors (more prone to change, but still useful)
    '.p-ia__nav__user__button',
    '.p-ia_sidebar_header__user_name',
    '.p-ia__sidebar_header__user__name',
    '.c-avatar__presence',
    
    // New Slack UI components
    '.p-huddle_sidebar_footer__presence_icon',
    '.p-setup_welcome_profile_member__name',
    '.p-ia4_profile_user_card__name',
    '.p-classic_nav__team_header__user__name',
    '.p-ia4_home_header_menu_button__user_name',
    '.p-top_nav__user__name'
  ];
  
  // Try the most reliable selectors first
  for (const selector of userSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // For image elements with alt text, use the alt attribute
      if (element.tagName === 'IMG' && element.alt) {
        const detectedName = element.alt.trim();
        if (detectedName && detectedName !== 'user icon') {
          console.log("Detected current user from profile image:", detectedName);
          processUserName(detectedName);
          return true;
        }
      }
      
      // For regular elements, use the text content
      const detectedName = element.textContent.trim();
      if (detectedName) {
        console.log("Detected current user from UI element:", detectedName);
        processUserName(detectedName);
        return true;
      }
    }
  }
  
  // Try extracting from URL - Slack sometimes includes user ID in the URL
  const urlMatch = window.location.href.match(/\/client\/([^\/]+)\/([^\/]+)/);
  if (urlMatch && urlMatch[2] && urlMatch[2].startsWith('U')) {
    // We found a user ID in the URL
    console.log("Found user ID in URL:", urlMatch[2]);
    
    // Try to find a matching name for this user ID in the DOM
    const userElements = document.querySelectorAll('[data-user-id="' + urlMatch[2] + '"]');
    for (const element of userElements) {
      if (element.textContent) {
        const detectedName = element.textContent.trim();
        console.log("Matched user ID to name:", detectedName);
        processUserName(detectedName);
        return true;
      }
    }
  }
  
  // Check user account menu by forcing it open temporarily
  const accountButton = document.querySelector('[data-qa="user-button"], .p-ia__nav__user');
  if (accountButton) {
    // Simulate click to open the account menu
    console.log("Attempting to extract username from account menu");
    // Store the original state to restore it later
    const originalDisplay = accountButton.style.display;
    
    try {
      // Try accessing user data without actually clicking
      const accountTooltip = document.querySelector('[data-qa="account_menu_tooltip"], .p-ia__main_menu__user__details');
      if (accountTooltip) {
        const nameElement = accountTooltip.querySelector('[data-qa="user-name"], .p-ia__main_menu__user__name');
        if (nameElement && nameElement.textContent) {
          const detectedName = nameElement.textContent.trim();
          console.log("Detected user from account tooltip:", detectedName);
          processUserName(detectedName);
          return true;
        }
      }
    } catch (e) {
      console.log("Error trying to access account menu:", e);
    } finally {
      // Restore original state
      accountButton.style.display = originalDisplay;
    }
  }
  
  // Check for username in page title
  const pageTitle = document.title;
  if (pageTitle && pageTitle.includes(" | ")) {
    const possibleName = pageTitle.split(" | ")[0].trim();
    if (possibleName && possibleName !== "Slack") {
      console.log("Detected possible user from page title:", possibleName);
      processUserName(possibleName);
      return true;
    }
  }
  
  // If all else fails, try to get the workspace name
  const workspaceElement = document.querySelector('[data-qa="team_name"], .p-classic_nav__team_header__team');
  if (workspaceElement && workspaceElement.textContent) {
    console.log("Could only detect workspace name:", workspaceElement.textContent.trim());
    // Set to Unknown without any hardcoded fallbacks
    userName = "Unknown";
    additionalUserNames = [];
    
    // Try again later, as the DOM may still be loading
    setTimeout(detectCurrentUser, 10000);
    return false;
  }
  
  console.log("Could not detect current user, using default checks");
  // Set to Unknown without any hardcoded fallbacks
  userName = "Unknown";
  additionalUserNames = [];
  
  // Try again after a delay, as the UI might be still loading
  setTimeout(detectCurrentUser, 15000);
  return false;
}

// Helper function to process detected username
function processUserName(detectedName) {
  userName = detectedName;
  
  // Generate variations of the username for additional checks
  const nameParts = detectedName.split(/\s+/);
  additionalUserNames = [];
  
  // Add first name
  if (nameParts.length > 0) {
    additionalUserNames.push(nameParts[0].toLowerCase());
  }
  
  // Add last name if available
  if (nameParts.length > 1) {
    additionalUserNames.push(nameParts[nameParts.length - 1].toLowerCase());
  }
  
  // Add first initial + last name (common username format)
  if (nameParts.length > 1) {
    const firstInitial = nameParts[0].charAt(0).toLowerCase();
    const lastName = nameParts[nameParts.length - 1].toLowerCase();
    additionalUserNames.push(firstInitial + lastName);
  }
  
  // No hardcoded usernames, all detection should be dynamic
  
  // Check for email pattern usernames (common in Slack)
  const emailRegex = /^([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})$/;
  if (emailRegex.test(detectedName)) {
    const emailParts = detectedName.split('@');
    if (emailParts.length > 0) {
      additionalUserNames.push(emailParts[0].toLowerCase());
    }
  }
  
  console.log("Generated additional usernames to check:", additionalUserNames);
}

// Try to detect the current user when the script loads and retry if needed
setTimeout(() => {
  const detected = detectCurrentUser();
  // If detection failed on first try, try again with more delay
  if (!detected) {
    console.log("First username detection attempt failed, will retry...");
    setTimeout(detectCurrentUser, 8000);
  }
}, 3000);

// Set up a MutationObserver to detect UI changes and retry username detection
const observer = new MutationObserver((mutations) => {
  // If we still don't have a username, try detecting again on significant DOM changes
  if (!userName || userName === "Unknown") {
    console.log("UI changed, retrying username detection");
    detectCurrentUser();
  }
});

// Start observing after a delay to let the page load
setTimeout(() => {
  observer.observe(document.body, { 
    childList: true, 
    subtree: true,
    attributes: false,
    characterData: false
  });
  console.log("Set up observer to detect UI changes");
}, 5000);

// Function to scan the page for mentions
function scanForMentions(manualCheck = false) {
  // Try to detect the current user if we haven't already
  if (!userName) {
    detectCurrentUser();
  }
    
    const currentTime = Date.now();
    console.log("Scanning for mentions at", new Date(currentTime).toLocaleTimeString());
    console.log("Current URL:", window.location.href);
    console.log("Current username:", userName, "Additional usernames:", additionalUserNames);
    
    // First, update workspace info whenever scanning occurs
    extractWorkspaceInfo();
    
    // Enhanced channel activity detection
    scanForChannelActivity(manualCheck);
    
    // Check for Slackbot messages in any channel
    if (window.location.pathname.includes('/client/') && currentChannelId) {
      // Detect if this is a Slackbot channel by looking for Slackbot messages
      const slackbotMessages = document.querySelectorAll(
        '.c-message__sender_button--slackbot, ' + 
        '[data-qa="message_sender_name"][aria-label="Slackbot"], ' +
        '.c-message_kit__sender--slackbot, ' +
        '.p-rich_text_block:contains("Slackbot")'
      );
      
      if (slackbotMessages.length > 0) {
        console.log(`Found ${slackbotMessages.length} Slackbot messages in channel ${currentChannelId}`);
        
        // Force username detection if we're in a Slackbot channel
        if (!userName || userName === "Unknown") {
          checkForUsernameInPage();
        }
        
        // Notify about Slackbot messages
        chrome.runtime.sendMessage({
          action: "mentionFound",
          id: generateId(),
          text: "You have a direct message from Slackbot",
          threadId: Date.now().toString(),
          channelId: currentChannelId,
          isDM: true,
          isMention: true,
          messageUrl: window.location.href
        });
      }
    }
    
    // Check if we're in a browser compatibility message page
    if (document.querySelector('h1') && document.querySelector('h1').textContent.includes('Please change browsers')) {
      console.log("Detected browser compatibility message. Slack may not be fully loaded.");
      // Still notify about the unread message based on URL
      const url = window.location.href;
      if (url.includes('/client/')) {
        const parts = url.split('/');
        const workspaceId = parts[parts.length - 2];
        const channelId = parts[parts.length - 1];
        
        // If this is a direct message channel (usually starts with D)
        if (channelId.startsWith('D')) {
          chrome.runtime.sendMessage({
            action: "mentionFound",
            id: generateId(),
            text: "You have an unread direct message. Please open Slack in a supported browser to view it.",
            threadId: Date.now().toString(),
            channelId: channelId,
            isDM: true
          });
        }
      }
      return;
    }
    
    // Look for messages that mention the user
    const messages = document.querySelectorAll('.c-message__body, .p-rich_text_section, [data-qa="message_content"]');
    
    if (messages.length === 0) {
      console.log("No message elements found. Checking for unread indicators.");
    } else {
      console.log(`Found ${messages.length} message elements`);
    }
    
    // Check if we're in a DM channel by URL
    const url = window.location.href;
    const isDMByUrl = url.includes('/client/') && url.split('/').pop().startsWith('D');
    
    messages.forEach(message => {
      // Check if the message contains the user's name or is a direct message
      const isDM = isDMByUrl || 
                  document.querySelector('.p-channel_sidebar__channel--im.p-channel_sidebar__channel--selected') !== null ||
                  document.querySelector('[data-qa="channel_header_channel_type_icon_dm"]') !== null;
      
      // Check for primary username or any additional usernames
      let isMention = (message.textContent.includes(userName) && userName !== "") || 
                      (message.textContent.includes('@' + userName) && userName !== "") ||
                      message.innerHTML.includes('data-stringify-at-mention');
      
      // Check for additional usernames
      for (const additionalName of additionalUserNames) {
        if (message.textContent.includes(additionalName) || 
            message.textContent.includes('@' + additionalName)) {
          isMention = true;
          console.log(`Found mention of additional username: ${additionalName}`);
          break;
        }
      }
      
      // Check for username mentions in any message
      if (userName && userName !== "Unknown") {
        if (message.textContent.includes(userName) || 
            message.textContent.includes('@' + userName)) {
          isMention = true;
          console.log(`Found mention of username: ${userName}`);
        }
      }
      
      if (isMention || isDM) {
        // Get the message container to extract more info
        const container = message.closest('.c-virtual_list__item, .c-message_kit__message, [data-qa="virtual-list-item"]');
        if (container) {
          const messageId = container.getAttribute('data-message-id') || generateId();
          const threadId = container.getAttribute('data-thread-ts') || container.getAttribute('data-ts') || '';
          const channelId = window.location.pathname.split('/').pop();
          
          // Check if this is a new mention since last check
          const messageTimestamp = parseInt(threadId.split('.')[0]) * 1000 || Date.now();
          if (messageTimestamp > lastCheckedTimestamp) {
            console.log("Found new mention/message:", message.textContent.substring(0, 50) + "...");
            
            // Get the current URL to create a direct link to the message
            let messageUrl = window.location.href;
            // Add the thread timestamp as a fragment if it's not already in the URL
            if (threadId && !messageUrl.includes(threadId)) {
              // Remove any existing fragment
              messageUrl = messageUrl.split('#')[0];
              // Add the thread timestamp as a fragment
              messageUrl += '#' + threadId;
            }
            
            // Send message to background script
            chrome.runtime.sendMessage({
              action: "mentionFound",
              id: messageId,
              text: message.textContent || "New message in Slack",
              threadId: threadId,
              channelId: channelId,
              isDM: isDM,
              isMention: isMention, // Flag to indicate if this is an actual mention
              messageUrl: messageUrl
            });
            
            // Highlight the message
            const messageElement = message.closest('.c-message, .c-message_kit__message, [data-qa="message-container"]');
            if (messageElement) {
              messageElement.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
            }
          }
        }
      }
    });
    
    lastCheckedTimestamp = currentTime;
}

// Enhanced function to scan for channel activity
function scanForChannelActivity(manualCheck = false) {
  console.log("Scanning for channel activity...", manualCheck ? "(MANUAL CHECK)" : "(AUTOMATIC)");
  
  // Multiple selectors for different types of unread/highlighted channels
  const channelActivitySelectors = [
    // Bold/highlighted channel names (unread activity)
    '.p-channel_sidebar__channel--unread',
    '.p-channel_sidebar__channel--highlighted',
    '.p-channel_sidebar__name--unread',
    
    // Channels with mention badges
    '.p-channel_sidebar__channel:has(.c-mention_badge)',
    '.p-channel_sidebar__channel:has([data-qa="mentions_badge"])',
    
    // Channels with unread indicators
    '[data-qa="channel_sidebar_unread_channel"]',
    '.c-channel_entity--unread',
    
    // Any channel with a red dot or badge
    '.p-channel_sidebar__channel:has(.p-channel_sidebar__badge)',
    '.p-channel_sidebar__channel:has(.c-badge)',
    
    // Channels that appear bold (CSS font-weight)
    '.p-channel_sidebar__name[style*="font-weight: bold"]',
    '.p-channel_sidebar__name[style*="font-weight:bold"]',
    
    // Modern Slack UI selectors
    '[data-qa="channel_sidebar_channel_button"]:has([data-qa="channel_sidebar_unread_badge"])',
    '[data-qa="channel_sidebar_channel_button"]:has(.c-mention_badge)',
    
    // Additional modern Slack selectors
    '[data-qa="channel_sidebar_channel_button"][aria-describedby*="unread"]',
    '.p-channel_sidebar__channel[aria-describedby*="unread"]',
    '.p-channel_sidebar__channel--has-unreads',
    '.p-channel_sidebar__channel--has-activity',
    
    // Channels with notification dots or indicators
    '.p-channel_sidebar__channel:has(.p-channel_sidebar__unread_indicator)',
    '.p-channel_sidebar__channel:has(.c-unread_indicator)',
    '[data-qa="channel_sidebar_channel_button"]:has([data-qa="unread_indicator"])',
    
    // Channels with bold text (different approaches)
    '.p-channel_sidebar__channel .p-channel_sidebar__name[style*="font-weight"]',
    '.p-channel_sidebar__channel .p-channel_sidebar__name.p-channel_sidebar__name--unread',
    
    // Generic unread/activity indicators
    '[data-qa*="unread"]',
    '[class*="unread"]',
    '[class*="highlighted"]',
    '[class*="activity"]'
  ];
  
  const foundChannels = new Set();
  let totalElementsFound = 0;
  
  channelActivitySelectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      totalElementsFound += elements.length;
      console.log(`Selector "${selector}" found ${elements.length} elements`);
      
      elements.forEach(element => {
        const channelInfo = extractChannelInfo(element);
        if (channelInfo && !foundChannels.has(channelInfo.channelId)) {
          foundChannels.add(channelInfo.channelId);
          
          // Only notify if it's been at least 30 seconds since last check, OR if this is a manual check
          if (manualCheck || Date.now() - lastCheckedTimestamp > 30000) {
            console.log(`Found activity in channel: ${channelInfo.channelName} (${channelInfo.channelId}) - NOTIFYING`);
            
            chrome.runtime.sendMessage({
              action: "mentionFound",
              id: generateId(),
              text: channelInfo.recentMessageText || `New activity in ${channelInfo.channelName || 'a channel'}`,
              threadId: Date.now().toString(),
              channelId: channelInfo.channelId,
              isDM: channelInfo.isDM,
              isMention: false, // Channel activity, not direct mention
              messageUrl: channelInfo.messageUrl,
              channelName: channelInfo.channelName
            });
          } else {
            console.log(`Found activity in channel: ${channelInfo.channelName} (${channelInfo.channelId}) - SKIPPED (time restriction)`);
          }
        }
      });
    } catch (error) {
      console.log(`Error with selector "${selector}":`, error);
    }
  });
  
  console.log(`Channel activity scan complete. Total elements found: ${totalElementsFound}, Unique channels: ${foundChannels.size}`);
  
  // Also check for channels that appear visually highlighted
  scanForVisuallyHighlightedChannels(foundChannels, manualCheck);
}

// Function to extract channel information from a channel element
function extractChannelInfo(channelElement) {
  try {
    // Find the channel name
    let channelName = '';
    const nameSelectors = [
      '.p-channel_sidebar__name',
      '.p-channel_sidebar__channel_name',
      '[data-qa="channel_sidebar_name"]',
      '.c-channel_entity__name',
      'span[data-qa="channel_sidebar_name_text"]'
    ];
    
    for (const selector of nameSelectors) {
      const nameElement = channelElement.querySelector(selector);
      if (nameElement && nameElement.textContent.trim()) {
        channelName = nameElement.textContent.trim();
        break;
      }
    }
    
    // If no name found, try getting it from the element itself
    if (!channelName) {
      channelName = channelElement.textContent.trim().split('\n')[0];
    }
    
    // Extract channel ID - improved method
    let channelId = channelElement.getAttribute('data-qa-channel-id') || 
                   channelElement.getAttribute('data-channel-id') ||
                   channelElement.getAttribute('data-qa-id');
    
    // Try to get channel ID from href - improved extraction
    if (!channelId) {
      const linkElement = channelElement.querySelector('a') || channelElement.closest('a');
      if (linkElement && linkElement.href) {
        const hrefMatch = linkElement.href.match(/\/client\/[^\/]+\/([^\/]+)/);
        if (hrefMatch && hrefMatch[1]) {
          channelId = hrefMatch[1];
        }
      }
    }
    
    // Try to get from data attributes with more patterns
    if (!channelId) {
      const dataAttrs = ['data-qa-id', 'data-channel-id', 'data-sk', 'data-sidebar-item-id'];
      for (const attr of dataAttrs) {
        const value = channelElement.getAttribute(attr);
        if (value && (value.startsWith('C') || value.startsWith('D') || value.startsWith('G'))) {
          channelId = value;
          break;
        }
      }
    }
    
    // Try to extract from onClick or other event handlers
    if (!channelId) {
      const onclick = channelElement.getAttribute('onclick') || '';
      const channelMatch = onclick.match(/[CDG][A-Z0-9]{8,}/);
      if (channelMatch) {
        channelId = channelMatch[0];
      }
    }
    
    // Get recent message text from the channel
    let recentMessageText = '';
    
    // Try to find message preview or snippet in the sidebar
    const messagePreviewSelectors = [
      '.p-channel_sidebar__channel_info',
      '.p-channel_sidebar__last_message',
      '.c-channel_entity__last_message',
      '[data-qa="channel_sidebar_last_message"]'
    ];
    
    for (const selector of messagePreviewSelectors) {
      const previewElement = channelElement.querySelector(selector);
      if (previewElement && previewElement.textContent.trim()) {
        recentMessageText = previewElement.textContent.trim();
        break;
      }
    }
    
    // If no preview found in sidebar, try to navigate to the channel and get recent message
    if (!recentMessageText && channelId) {
      recentMessageText = getRecentMessageFromChannel(channelId, channelName);
    }
    
    // Fallback to generic text if no recent message found
    if (!recentMessageText) {
      recentMessageText = `New activity detected in ${channelName}. Check the channel for recent updates.`;
    }
    
    // Determine if it's a DM
    const isDM = channelElement.classList.contains('p-channel_sidebar__channel--im') ||
                channelElement.querySelector('[data-qa="channel_header_channel_type_icon_dm"]') !== null ||
                channelName.includes('Direct message with') ||
                (channelId && channelId.startsWith('D'));
    
    // Generate channel ID if still not found - use channel name hash
    if (!channelId) {
      // Create a more stable ID based on channel name
      const nameHash = channelName.replace(/[^\w-]/g, '').toLowerCase();
      channelId = 'GEN_' + nameHash + '_' + btoa(channelName).substr(0, 8);
    }
    
    // Construct message URL - improved URL construction
    const currentUrl = window.location.href;
    const urlMatch = currentUrl.match(/\/client\/([^\/]+)/);
    const workspaceId = urlMatch ? urlMatch[1] : '';
    
    let messageUrl = currentUrl;
    if (workspaceId && channelId && channelId !== 'unknown') {
      messageUrl = `https://app.slack.com/client/${workspaceId}/${channelId}`;
    }
    
    return {
      channelName,
      channelId,
      isDM,
      messageUrl,
      recentMessageText
    };
  } catch (error) {
    console.log('Error extracting channel info:', error);
    return null;
  }
}

// Function to get recent message from a specific channel
function getRecentMessageFromChannel(channelId, channelName) {
  try {
    // Check if we're currently in the target channel
    const currentUrl = window.location.href;
    if (currentUrl.includes(channelId)) {
      // We're in the channel, get the most recent message
      const messages = document.querySelectorAll('.c-message__body, .p-rich_text_section, [data-qa="message_content"]');
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        return lastMessage.textContent.trim().substring(0, 200) + (lastMessage.textContent.length > 200 ? '...' : '');
      }
    }
    
    // If not in the channel, look for any cached or preview information
    const channelElements = document.querySelectorAll(`[data-qa-channel-id="${channelId}"], [data-channel-id="${channelId}"]`);
    for (const element of channelElements) {
      const messagePreview = element.querySelector('.p-channel_sidebar__last_message, .c-channel_entity__last_message');
      if (messagePreview && messagePreview.textContent.trim()) {
        return messagePreview.textContent.trim();
      }
    }
    
    return `Check recent activity in #${channelName}`;
  } catch (error) {
    console.log('Error getting recent message:', error);
    return `New activity in #${channelName}`;
  }
}

// Function to scan for visually highlighted channels (bold text, etc.)
function scanForVisuallyHighlightedChannels(foundChannels, manualCheck) {
  // Get all channel name elements
  const channelNameElements = document.querySelectorAll(
    '.p-channel_sidebar__name, .p-channel_sidebar__channel_name, [data-qa="channel_sidebar_name"]'
  );
  
  channelNameElements.forEach(nameElement => {
    try {
      const computedStyle = window.getComputedStyle(nameElement);
      const fontWeight = computedStyle.fontWeight;
      
      // Check if the channel appears bold (font-weight > 400 is typically bold)
      if (fontWeight === 'bold' || fontWeight === '700' || parseInt(fontWeight) > 400) {
        const channelElement = nameElement.closest('.p-channel_sidebar__channel, [data-qa="channel_sidebar_channel_button"]');
        if (channelElement) {
          const channelInfo = extractChannelInfo(channelElement);
          if (channelInfo && !foundChannels.has(channelInfo.channelId)) {
            foundChannels.add(channelInfo.channelId);
            
            // Only notify if it's been at least 30 seconds since last check, OR if this is a manual check
            if (manualCheck || Date.now() - lastCheckedTimestamp > 30000) {
              console.log(`Found visually highlighted channel: ${channelInfo.channelName} (${channelInfo.channelId})`);
              
              chrome.runtime.sendMessage({
                action: "mentionFound",
                id: generateId(),
                text: channelInfo.recentMessageText || `New activity in ${channelInfo.channelName || 'a channel'} (highlighted)`,
                threadId: Date.now().toString(),
                channelId: channelInfo.channelId,
                isDM: channelInfo.isDM,
                isMention: false,
                messageUrl: channelInfo.messageUrl,
                channelName: channelInfo.channelName
              });
            }
          }
        }
      }
    } catch (error) {
      console.log('Error checking visual highlighting:', error);
    }
  });
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

// Helper function to generate a random ID
function generateId() {
  return 'msg_' + Math.random().toString(36).substr(2, 9);
}

// Initial scan when the script loads
setTimeout(() => {
  detectCurrentUser();
  scanForMentions(); // This is automatic, so manualCheck defaults to false
}, 5000);

// Set up periodic scanning
setInterval(scanForMentions, 30000); // Check every 30 seconds - automatic, so manualCheck defaults to false

// Keep content script active and responsive
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    console.log("Slack tab became visible - resuming monitoring");
    scanForMentions(true); // Force immediate check when tab becomes visible
  }
});

// Periodic heartbeat to keep script alive and log activity
setInterval(() => {
  console.log("Content script heartbeat:", new Date().toLocaleTimeString());
  
  // Also check if we're still on a Slack page
  if (window.location.href.includes('slack.com')) {
    // Ensure we have workspace info
    extractWorkspaceInfo();
  }
}, 60000); // Every minute

// Function to check for username clues in the page when detection methods fail
function checkForUsernameInPage() {
  // Check page title for username
  const pageTitle = document.title;
  if (pageTitle && pageTitle.includes(" | ")) {
    const possibleName = pageTitle.split(" | ")[0].trim();
    if (possibleName && possibleName !== "Slack") {
      console.log("Detected possible user from page title:", possibleName);
      processUserName(possibleName);
      return true;
    }
  }
  
  // Check for any user profile data in DOM
  const userProfileElements = [
    '[data-qa="user_profile_name"]',
    '.p-ia__nav__user_username',
    '.p-ia4_profile_user_card__name',
    'button[data-qa="header-user-button"]'
  ];
  
  for (const selector of userProfileElements) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      const detectedName = element.textContent.trim();
      if (detectedName) {
        console.log("Found username in profile element:", detectedName);
        processUserName(detectedName);
        return true;
      }
    }
  }
  
  // Check if there's any email address in the user menu
  const emailElement = document.querySelector('[data-qa="user_profile_email"]');
  if (emailElement && emailElement.textContent) {
    const email = emailElement.textContent.trim();
    if (email.includes('@')) {
      console.log("Found user email:", email);
      // Extract username from email address
      const username = email.split('@')[0];
      processUserName(username);
      return true;
    }
  }
  
  // If still no username, check for personal messages that might indicate username
  const myMessages = document.querySelectorAll('[data-qa="message_sender--me"]');
  if (myMessages.length > 0) {
    // Get name from parent's siblings
    const nameElement = myMessages[0].closest('[data-qa="message_container"]')?.querySelector('[data-qa="message_sender_name"]');
    if (nameElement && nameElement.textContent) {
      const detectedName = nameElement.textContent.trim();
      console.log("Extracted username from own messages:", detectedName);
      processUserName(detectedName);
      return true;
    }
  }
  
  // Last resort - look for profile avatar and extract alt text
  const avatarImg = document.querySelector('[data-qa="user_profile_avatar"] img, .p-ia__nav__user img');
  if (avatarImg && avatarImg.alt) {
    console.log("Found username from avatar:", avatarImg.alt);
    processUserName(avatarImg.alt);
    return true;
  }
  
  // If we still couldn't detect automatically, check for common usernames in URL
  const url = window.location.href;
  // Extract any signs of a username from URLs, cookies, or local storage
  const commonUsernameCookies = document.cookie.match(/user_name=([^;]+)/);
  if (commonUsernameCookies && commonUsernameCookies[1]) {
    processUserName(decodeURIComponent(commonUsernameCookies[1]));
    return true;
  }
  
  // If everything fails, set to Unknown but keep checking
  console.log("Could not detect username through any method, using Unknown");
  userName = "Unknown";
  additionalUserNames = [];
  return false;
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
    
    // Set up more frequent scanning for any Slack channel 
    if (url.includes('/client/')) {
      console.log("Detected Slack client URL, setting up frequent scanning");
      scanForMentions(); // Immediate scan after URL change - automatic, so manualCheck defaults to false
    }
  }
}).observe(document, {subtree: true, childList: true});

// Log that the content script has loaded
console.log("Slack Mention Monitor content script loaded at", new Date().toLocaleTimeString());

// Debug function to help troubleshoot channel activity detection
// Can be called from browser console: window.debugSlackChannels()
window.debugSlackChannels = function() {
  console.log("=== DEBUG: Slack Channel Activity Detection ===");
  console.log("Current URL:", window.location.href);
  
  // Check for sidebar
  const sidebar = document.querySelector('.p-channel_sidebar, [data-qa="channel_sidebar"]');
  console.log("Sidebar found:", !!sidebar);
  
  if (sidebar) {
    // Look for all channel elements
    const allChannels = sidebar.querySelectorAll('.p-channel_sidebar__channel, [data-qa="channel_sidebar_channel_button"]');
    console.log(`Total channels found: ${allChannels.length}`);
    
    // Check each channel for activity indicators
    allChannels.forEach((channel, index) => {
      const nameElement = channel.querySelector('.p-channel_sidebar__name, [data-qa="channel_sidebar_name"]');
      const channelName = nameElement ? nameElement.textContent.trim() : 'Unknown';
      
      // Check for various activity indicators
      const hasUnreadClass = channel.classList.contains('p-channel_sidebar__channel--unread');
      const hasHighlightedClass = channel.classList.contains('p-channel_sidebar__channel--highlighted');
      const hasBadge = channel.querySelector('.c-mention_badge, .p-channel_sidebar__badge, .c-badge');
      const hasUnreadIndicator = channel.querySelector('.p-channel_sidebar__unread_indicator, .c-unread_indicator');
      
      // Check font weight
      const computedStyle = nameElement ? window.getComputedStyle(nameElement) : null;
      const fontWeight = computedStyle ? computedStyle.fontWeight : 'unknown';
      const isBold = fontWeight === 'bold' || fontWeight === '700' || parseInt(fontWeight) > 400;
      
      if (hasUnreadClass || hasHighlightedClass || hasBadge || hasUnreadIndicator || isBold) {
        console.log(`Channel ${index + 1}: "${channelName}" - ACTIVITY DETECTED`);
        console.log(`  - Unread class: ${hasUnreadClass}`);
        console.log(`  - Highlighted class: ${hasHighlightedClass}`);
        console.log(`  - Has badge: ${!!hasBadge}`);
        console.log(`  - Has unread indicator: ${!!hasUnreadIndicator}`);
        console.log(`  - Font weight: ${fontWeight} (bold: ${isBold})`);
        console.log(`  - Element:`, channel);
      }
    });
  }
  
  console.log("=== END DEBUG ===");
};
