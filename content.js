// Content script that runs in the context of the Slack page

// Store references to important elements
let lastCheckedTimestamp = Date.now();
let userName = "Drew Bomhof";
let additionalUserNames = ["dbomhof"]; // Add additional usernames to check for

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkMentions") {
    scanForMentions();
  } else if (message.action === "sendResponse") {
    sendSlackResponse(message.threadId, message.responseText);
  }
  return true;
});

// Get user settings
chrome.storage.local.get(['userName', 'additionalUserNames'], (data) => {
  if (data.userName) {
    userName = data.userName;
  }
  if (data.additionalUserNames) {
    additionalUserNames = data.additionalUserNames;
  }
});

// Function to scan the page for mentions
function scanForMentions() {
  // Get the current user name from storage
  chrome.storage.local.get(['userName', 'additionalUserNames'], (data) => {
    if (data.userName) {
      userName = data.userName;
    }
    if (data.additionalUserNames) {
      additionalUserNames = data.additionalUserNames;
    }
    
    const currentTime = Date.now();
    console.log("Scanning for mentions at", new Date(currentTime).toLocaleTimeString());
    
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
      let isMention = message.textContent.includes(userName) || 
                      message.textContent.includes('@' + userName) ||
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
      
      // Special check for the specific URL
      if (window.location.href.includes('client/E030G10V24F/D03SPCDSBFW')) {
        console.log("Checking specific Slack conversation for dbomhof mentions");
        if (message.textContent.includes('dbomhof') || 
            message.textContent.includes('@dbomhof')) {
          isMention = true;
          console.log("Found dbomhof mention in the specific conversation");
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
            
            // Send message to background script
            chrome.runtime.sendMessage({
              action: "mentionFound",
              id: messageId,
              text: message.textContent || "New message in Slack",
              threadId: threadId,
              channelId: channelId,
              isDM: isDM
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
            const channelId = channelElement.getAttribute('data-qa-channel-id') || 
                             channelElement.getAttribute('data-channel-id') ||
                             generateId();
            
            const isDM = channelElement.classList.contains('p-channel_sidebar__channel--im') ||
                        channelElement.querySelector('[data-qa="channel_header_channel_type_icon_dm"]') !== null;
            
            // Only notify about new unread messages
            if (Date.now() - lastCheckedTimestamp > 10000) { // Only if it's been at least 10 seconds
              chrome.runtime.sendMessage({
                action: "mentionFound",
                id: generateId(),
                text: `You have unread messages in ${channelName || (isDM ? "a direct message" : "a channel")}`,
                threadId: Date.now().toString(),
                channelId: channelId,
                isDM: isDM
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
        chrome.runtime.sendMessage({
          action: "mentionFound",
          id: generateId(),
          text: "You have unread mentions or messages in Slack",
          threadId: Date.now().toString(),
          channelId: "general",
          isDM: false
        });
      }
    }
    
    // Check if we're in a DM channel by URL and notify
    if (isDMByUrl && Date.now() - lastCheckedTimestamp > 30000) { // Only check every 30 seconds
      const channelId = window.location.pathname.split('/').pop();
      chrome.runtime.sendMessage({
        action: "mentionFound",
        id: generateId(),
        text: "You have a direct message conversation open",
        threadId: Date.now().toString(),
        channelId: channelId,
        isDM: true
      });
    }
    
    lastCheckedTimestamp = currentTime;
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
setTimeout(scanForMentions, 5000);

// Set up periodic scanning
setInterval(scanForMentions, 30000); // Check every 30 seconds

// Special check for the specific URL
if (window.location.href.includes('client/E030G10V24F/D03SPCDSBFW')) {
  console.log("Detected specific Slack conversation URL, checking more frequently");
  setInterval(() => {
    console.log("Running special check for dbomhof mentions");
    scanForMentions();
  }, 10000); // Check every 10 seconds for this specific URL
}

// Log that the content script has loaded
console.log("Slack Mention Monitor content script loaded at", new Date().toLocaleTimeString());
