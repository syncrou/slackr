// Content script that runs in the context of the Slack page

// Store references to important elements
let lastCheckedTimestamp = Date.now();
let userName = "Drew Bomhof";

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
chrome.storage.local.get(['userName'], (data) => {
  if (data.userName) {
    userName = data.userName;
  }
});

// Function to scan the page for mentions
function scanForMentions() {
  // This is a simplified approach - in a real implementation,
  // you would need to handle Slack's dynamic content loading
  
  // Look for messages that mention the user
  const messages = document.querySelectorAll('.c-message__body');
  const currentTime = Date.now();
  
  messages.forEach(message => {
    // Check if the message contains the user's name
    if (message.textContent.includes(userName)) {
      // Get the message container to extract more info
      const container = message.closest('.c-virtual_list__item');
      if (container) {
        const messageId = container.getAttribute('data-message-id') || generateId();
        const threadId = container.getAttribute('data-thread-ts') || container.getAttribute('data-ts') || '';
        const channelId = window.location.pathname.split('/').pop();
        
        // Check if this is a new mention since last check
        const messageTimestamp = parseInt(threadId.split('.')[0]) * 1000;
        if (messageTimestamp > lastCheckedTimestamp) {
          // Send message to background script
          chrome.runtime.sendMessage({
            action: "mentionFound",
            id: messageId,
            text: message.textContent,
            threadId: threadId,
            channelId: channelId
          });
          
          // Highlight the message
          message.closest('.c-message').style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
        }
      }
    }
  });
  
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
setTimeout(scanForMentions, 5000);
