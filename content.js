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
  if (message.action === "checkMentions") {
    // Just scan for mentions - no response needed
    scanForMentions();
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
function scanForMentions() {
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
    
    // Check for unread indicators in the sidebar
    const unreadIndicators = [
      '.p-channel_sidebar__channel--unread',
      '[data-qa="channel_sidebar_unread_channel"]',
      '.c-mention_badge',
      '[data-qa="mentions_badge"]'
    ];
    
    unreadIndicators.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`Found ${elements.length} unread indicators with selector: ${selector}`);
        
        elements.forEach(element => {
          const channelName = element.textContent.trim();
          const channelElement = element.closest('[data-qa="channel_sidebar_channel_button"]') || 
                                element.closest('.p-channel_sidebar__channel');
          
          if (channelElement) {
            // More robust channel ID extraction with advanced fallbacks
            let channelId = channelElement.getAttribute('data-qa-channel-id') || 
                           channelElement.getAttribute('data-channel-id');
            
            // If we still don't have a channel ID, try to get it from the href attribute
            if (!channelId) {
              const linkElement = channelElement.querySelector('a');
              if (linkElement && linkElement.href) {
                const hrefMatch = linkElement.href.match(/\/client\/[^\/]+\/([^\/]+)/);
                if (hrefMatch && hrefMatch[1]) {
                  channelId = hrefMatch[1];
                  console.log("Extracted channel ID from href:", channelId);
                }
              }
            }
            
            // If we still don't have a channel ID, try to extract it from data attributes
            if (!channelId) {
              // Some channels have a data-stringify-id attribute
              channelId = channelElement.getAttribute('data-stringify-id') || 
                          channelElement.getAttribute('data-channel-id') ||
                          channelElement.getAttribute('data-qa-id');
            }
            
            // Special handling for team channels (like team-red-chesterfield-lead)
            if (!channelId && channelName && channelName.includes('team-')) {
              // For team channels, try to find or construct an ID based on the name
              console.log("Detected potential team channel:", channelName);
              
              // Check if it's a private channel
              const isPrivate = channelElement.classList.contains('p-channel_sidebar__channel--private') ||
                               (channelElement.querySelector('.p-channel_sidebar__channel_icon_prefix--private') !== null);
              
              // For private channels, IDs typically start with 'G', for regular channels with 'C'
              const prefix = isPrivate ? 'G' : 'C';
              
              // Try to find the ID in data attributes that might contain it
              const allAttributes = Array.from(channelElement.attributes)
                .filter(attr => attr.name.startsWith('data-') && attr.value.startsWith(prefix))
                .map(attr => attr.value);
              
              if (allAttributes.length > 0) {
                channelId = allAttributes[0];
                console.log("Found team channel ID from attributes:", channelId);
              } else {
                // As a last resort, store the channel name for a lookup approach
                // This will use the stored workspace ID and regular URL format
                channelId = channelName.replace(/[^\w-]/g, '').toLowerCase();
                console.log("Using formatted channel name as ID:", channelId);
              }
            }
            
            // If we still don't have a channel ID, generate one but add the channel name as a suffix
            // This improves the chances of matching even with generated IDs
            if (!channelId) {
              channelId = generateId() + (channelName ? '_' + channelName.replace(/[^\w-]/g, '') : '');
              console.log("Generated channel ID with name suffix:", channelId);
            }
            
            const isDM = channelElement.classList.contains('p-channel_sidebar__channel--im') ||
                        channelElement.querySelector('[data-qa="channel_header_channel_type_icon_dm"]') !== null;
            
        // Only notify about new unread messages
        if (Date.now() - lastCheckedTimestamp > 10000) { // Only if it's been at least 10 seconds
          // Extract workspace ID from current URL
          const currentUrl = window.location.href;
          let workspaceId = "";
          const urlMatch = currentUrl.match(/\/client\/([^\/]+)/);
          if (urlMatch && urlMatch[1]) {
            workspaceId = urlMatch[1];
          } else {
            // Fallback to the default workspace ID if available in storage
            chrome.storage.local.get('workspaceId', (data) => {
              if (data && data.workspaceId) {
                workspaceId = data.workspaceId;
                console.log("Using stored workspace ID:", workspaceId);
              }
            });
          }
          
          // Construct a proper URL for this specific channel
          let messageUrl = currentUrl;
          if (workspaceId && channelId) {
            // For team channels with custom names, ensure we use the proper URL format
            if (channelName && channelName.includes('team-')) {
              console.log(`Constructing special URL for team channel: ${channelName}`);
            }
            messageUrl = `https://app.slack.com/client/${workspaceId}/${channelId}`;
            console.log(`Constructed channel URL: ${messageUrl} for channel: ${channelName || channelId}`);
          }
  
          chrome.runtime.sendMessage({
                action: "mentionFound",
                id: generateId(),
                text: `You have unread messages in ${channelName || (isDM ? "a direct message" : "a channel")}`,
                threadId: Date.now().toString(),
                channelId: channelId,
                isDM: isDM,
                isMention: false, // Not a direct mention
                messageUrl: messageUrl
              });
            }
          }
        });
      }
    });
    
    // Check for the red dot notification indicator
    const redDots = document.querySelectorAll('.c-mention_badge, [data-qa="mentions_badge"]');
    if (redDots.length > 0) {
      console.log(`Found ${redDots.length} red dot notifications`);
      
      // Notify about mentions
      if (Date.now() - lastCheckedTimestamp > 10000) { // Only if it's been at least 10 seconds
        // Extract workspace ID from current URL
        const currentUrl = window.location.href;
        let workspaceId = "";
        const urlMatch = currentUrl.match(/\/client\/([^\/]+)/);
        if (urlMatch && urlMatch[1]) {
          workspaceId = urlMatch[1];
        }
        
        // For red dot notifications, we use the general channel
        const generalChannelId = "general";
        
        // Construct a proper URL for the general channel
        let messageUrl = currentUrl;
        if (workspaceId && generalChannelId) {
          messageUrl = `https://app.slack.com/client/${workspaceId}/${generalChannelId}`;
        }
      
        chrome.runtime.sendMessage({
          action: "mentionFound",
          id: generateId(),
          text: "You have unread mentions or messages in Slack",
          threadId: Date.now().toString(),
          channelId: "general",
          isDM: false,
          isMention: false, // Not a direct mention
          messageUrl: messageUrl
        });
      }
    }
    
    // Check if we're in a DM channel by URL and notify
    if (isDMByUrl && Date.now() - lastCheckedTimestamp > 30000) { // Only check every 30 seconds
      const channelId = window.location.pathname.split('/').pop();
      
      // Extract workspace ID from current URL
      const currentUrl = window.location.href;
      let workspaceId = "";
      const urlMatch = currentUrl.match(/\/client\/([^\/]+)/);
      if (urlMatch && urlMatch[1]) {
        workspaceId = urlMatch[1];
      }
      
      // Construct a proper URL for this specific DM channel
      let messageUrl = currentUrl;
      if (workspaceId && channelId) {
        messageUrl = `https://app.slack.com/client/${workspaceId}/${channelId}`;
      }
    
      chrome.runtime.sendMessage({
        action: "mentionFound",
        id: generateId(),
        text: "You have a direct message conversation open",
        threadId: Date.now().toString(),
        channelId: channelId,
        isDM: true,
        isMention: false, // Not a direct mention
        messageUrl: messageUrl
      });
    }
    
    lastCheckedTimestamp = currentTime;
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
  scanForMentions();
}, 5000);

// Set up periodic scanning
setInterval(scanForMentions, 30000); // Check every 30 seconds

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
      scanForMentions(); // Immediate scan after URL change
    }
  }
}).observe(document, {subtree: true, childList: true});

// Log that the content script has loaded
console.log("Slack Mention Monitor content script loaded at", new Date().toLocaleTimeString());
