// Popup script that handles the extension popup UI

document.addEventListener('DOMContentLoaded', function() {
  // Load mentions from storage
  loadMentions();
  
  // Load settings
  loadSettings();
  
  // Add event listener for settings save button
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  
  // Add event listener for check now button
  document.getElementById('check-now').addEventListener('click', checkForMentionsNow);
  
  // Add event listener for use Gemini button
  document.getElementById('use-gemini').addEventListener('click', useGemini);
  
  // Add event listener for stop using Gemini button
  document.getElementById('stop-using-gemini').addEventListener('click', stopUsingGemini);
});

// Function to enable Gemini
function useGemini() {
  chrome.storage.local.set({ 
    useGemini: true
  }, () => {
    document.getElementById('gemini-active').style.display = 'block';
    document.getElementById('gemini-available').style.display = 'none';
    document.getElementById('api-settings').style.display = 'none';
    alert("Now using Gemini for AI responses!");
  });
}

// Function to disable Gemini
function stopUsingGemini() {
  chrome.storage.local.set({ 
    useGemini: false
  }, () => {
    document.getElementById('gemini-active').style.display = 'none';
    document.getElementById('api-settings').style.display = 'block';
    checkGeminiAvailability();
    alert("Stopped using Gemini. Please configure an API provider.");
  });
}

// Function to manually check for mentions
function checkForMentionsNow() {
  chrome.runtime.sendMessage({action: "checkMentionsManually"}, (response) => {
    if (response && response.success) {
      alert("Checking for mentions...");
      // Reload mentions after a short delay to allow for processing
      setTimeout(loadMentions, 2000);
    } else {
      alert("Error: " + (response ? response.error : "Unknown error"));
    }
  });
}

// Load mentions from storage
function loadMentions() {
  chrome.storage.local.get('mentions', (data) => {
    const mentions = data.mentions || [];
    const container = document.getElementById('mentions-container');
    const noMentionsElement = document.getElementById('no-mentions');
    
    if (mentions.length === 0) {
      noMentionsElement.style.display = 'block';
      return;
    }
    
    noMentionsElement.style.display = 'none';
    
    // Sort mentions by timestamp (newest first)
    mentions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Clear container
    container.innerHTML = '';
    
    // Add mentions to container
    mentions.forEach(mention => {
      const mentionElement = document.createElement('div');
      mentionElement.className = 'mention';
      mentionElement.dataset.id = mention.id;
      mentionElement.dataset.threadId = mention.threadId;
      mentionElement.dataset.channelId = mention.channelId;
      
      // Add click handler to the mention element if we have a message URL
      if (mention.messageUrl) {
        mentionElement.style.cursor = 'pointer';
        mentionElement.title = 'Click to open this message in Slack';
        mentionElement.addEventListener('click', () => {
          openSlackMessage(mention.messageUrl);
          
          // Remove the mention from storage when clicked
          chrome.storage.local.get('mentions', (data) => {
            const mentions = data.mentions || [];
            const updatedMentions = mentions.filter(m => m.id !== mention.id);
            chrome.storage.local.set({ mentions: updatedMentions }, () => {
              // Reload mentions
              loadMentions();
            });
          });
        });
      }
      
      const textElement = document.createElement('div');
      textElement.className = 'mention-text';
      textElement.textContent = mention.text;
      
      const timestampElement = document.createElement('div');
      timestampElement.className = 'timestamp';
      timestampElement.textContent = formatTimestamp(mention.timestamp);
      
      const responsesElement = document.createElement('div');
      responsesElement.className = 'responses';
      
      // Add suggested responses only if it's an actual mention
      if (mention.isMention && mention.suggestedResponses && mention.suggestedResponses.length > 0) {
        mention.suggestedResponses.forEach(response => {
          const responseButton = document.createElement('button');
          responseButton.className = 'response-btn';
          responseButton.textContent = response;
          responseButton.addEventListener('click', () => {
            sendResponse(mention.threadId, response);
          });
          responsesElement.appendChild(responseButton);
        });
      }
      
      mentionElement.appendChild(textElement);
      mentionElement.appendChild(timestampElement);
      mentionElement.appendChild(responsesElement);
      
      container.appendChild(mentionElement);
    });
  });
}

// Format timestamp to readable date/time
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Function to open a Slack message in the active Slack tab
function openSlackMessage(messageUrl) {
  chrome.tabs.query({url: "https://app.slack.com/*"}, (tabs) => {
    if (tabs.length > 0) {
      // Navigate to the message URL
      chrome.tabs.update(tabs[0].id, {active: true, url: messageUrl});
    } else {
      // If no Slack tab is open, open a new one
      chrome.tabs.create({url: messageUrl});
    }
  });
}

// Send a response to a Slack thread
function sendResponse(threadId, responseText) {
  chrome.tabs.query({url: "https://app.slack.com/client/*/C*"}, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "sendResponse",
        threadId: threadId,
        responseText: responseText
      });
      
      // Show confirmation
      alert("Response sent!");
      
      // Remove the mention from storage
      chrome.storage.local.get('mentions', (data) => {
        const mentions = data.mentions || [];
        const updatedMentions = mentions.filter(m => m.threadId !== threadId);
        chrome.storage.local.set({ mentions: updatedMentions }, () => {
          // Reload mentions
          loadMentions();
        });
      });
    } else {
      alert("No Slack tab is open. Please open Slack first.");
    }
  });
}

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get(['apiType', 'apiKey', 'useGemini'], (data) => {
    if (data.apiType) {
      document.getElementById('api-type').value = data.apiType;
    }
    if (data.apiKey) {
      document.getElementById('api-key').value = data.apiKey;
    }
    
    // Check if Gemini is being used
    if (data.useGemini) {
      document.getElementById('gemini-active').style.display = 'block';
      document.getElementById('api-settings').style.display = 'none';
    } else {
      document.getElementById('gemini-active').style.display = 'none';
      document.getElementById('api-settings').style.display = 'block';
      
      // Check if Gemini is available
      checkGeminiAvailability();
    }
  });
  
  // Get the detected username from active Slack tabs
  chrome.tabs.query({url: "https://app.slack.com/*"}, (tabs) => {
    if (tabs.length > 0) {
      // First check if we're on the login page
      chrome.tabs.sendMessage(tabs[0].id, {action: "checkSlackLoginStatus"}, (response) => {
        const usernameDisplay = document.getElementById('username-display');
        
        // Check for runtime error which might indicate content script hasn't loaded
        const error = chrome.runtime.lastError;
        if (error) {
          usernameDisplay.textContent = 'Waiting for Slack to load...';
          usernameDisplay.style.color = '#f0ad4e';
          return;
        }
        
        if (response && response.isLoginPage) {
          usernameDisplay.textContent = 'Please sign in to Slack first';
          usernameDisplay.style.color = '#d9534f';
          return;
        }
        
        // If not on login page, try to get username
        chrome.tabs.sendMessage(tabs[0].id, {action: "getDetectedUsername"}, (response) => {
          if (response && response.userName) {
            usernameDisplay.textContent = response.userName;
            usernameDisplay.style.color = '#5cb85c';
            
            if (response.additionalUserNames && response.additionalUserNames.length > 0) {
              const additionalNames = document.createElement('div');
              additionalNames.style.fontSize = '0.8em';
              additionalNames.style.color = '#888';
              additionalNames.style.marginTop = '5px';
              additionalNames.textContent = 'Also checking for: ' + response.additionalUserNames.join(', ');
              usernameDisplay.appendChild(additionalNames);
            }
          } else {
            usernameDisplay.textContent = 'Not detected (Slack is open but username not found)';
            usernameDisplay.style.color = '#f0ad4e';
          }
        });
      });
    } else {
      const usernameDisplay = document.getElementById('username-display');
      usernameDisplay.textContent = 'Not detected (open Slack to detect)';
      usernameDisplay.style.color = '#d9534f';
    }
  });
}

// Check if Gemini is available in another tab
function checkGeminiAvailability() {
  chrome.tabs.query({url: "https://gemini.google.com/app/*"}, (tabs) => {
    const geminiAvailableDiv = document.getElementById('gemini-available');
    
    if (tabs.length > 0) {
      // Gemini is available
      geminiAvailableDiv.style.display = 'block';
    } else {
      // Gemini is not available
      geminiAvailableDiv.style.display = 'none';
    }
  });
}

// Save settings to storage
function saveSettings() {
  const apiType = document.getElementById('api-type').value;
  const apiKey = document.getElementById('api-key').value.trim();
  
  if (!apiKey) {
    alert("Please enter an API key.");
    return;
  }
  
  chrome.storage.local.set({ 
    apiType: apiType,
    apiKey: apiKey,
    useGemini: false
  }, () => {
    alert("Settings saved!");
  });
}
