// Popup script that handles the extension popup UI

// Default Slack URL (can be overridden by user settings)
const DEFAULT_SLACK_URL = 'https://app.slack.com/client/E030G10V24F/C06M9SL8JM6';

document.addEventListener('DOMContentLoaded', function() {
  // Load mentions from storage
  loadMentions();
  
  // Load settings
  loadSettings();
  
  // Trigger an immediate check for fresh data
  chrome.runtime.sendMessage({action: "checkMentionsManually"}, (response) => {
    if (response && response.success) {
      // Reload mentions after a short delay to allow for processing
      setTimeout(() => {
        loadMentions();
      }, 1000);
    }
  });
  
  // Add event listener for settings toggle
  document.getElementById('settings-toggle').addEventListener('click', toggleSettings);
  
  // Add event listener for API settings save button
  document.getElementById('save-api-settings').addEventListener('click', saveApiSettings);
  
  // Add event listener for Slack URL save button
  document.getElementById('save-slack-url').addEventListener('click', saveSlackUrl);
  
  // Add event listener for check now button
  document.getElementById('check-now').addEventListener('click', checkForMentionsNow);
  
  // Add event listener for use Gemini button
  document.getElementById('use-gemini').addEventListener('click', useGemini);
  
  // Add event listener for stop using Gemini button
  document.getElementById('stop-using-gemini').addEventListener('click', stopUsingGemini);
  
  // Add event listener for check Gemini button
  document.getElementById('check-gemini').addEventListener('click', checkGeminiAvailability);
  
  // Open the configured Slack channel if needed and get username
  openConfiguredSlackChannel();
  
  // Check background monitoring status
  checkBackgroundStatus();
});

// Function to show notices instead of alerts
function showNotice(message, type = 'info', duration = 3000) {
  const noticeId = `notice-${type}`;
  const noticeElement = document.getElementById(noticeId);
  
  if (noticeElement) {
    noticeElement.textContent = message;
    noticeElement.style.display = 'block';
    
    // Hide after duration
    setTimeout(() => {
      if (noticeElement) {
        noticeElement.style.display = 'none';
      }
    }, duration);
  } else {
    console.log(`Notice element ${noticeId} not found for message: ${message}`);
  }
}

// Function to toggle settings panel
function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  const arrow = document.getElementById('settings-arrow');
  
  if (panel.classList.contains('expanded')) {
    panel.classList.remove('expanded');
    arrow.classList.remove('expanded');
  } else {
    panel.classList.add('expanded');
    arrow.classList.add('expanded');
    // Check Gemini availability when settings are opened
    checkGeminiAvailability();
  }
}

// Function to get the configured Slack URL
function getConfiguredSlackUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get('slackUrl', (data) => {
      resolve(data.slackUrl || DEFAULT_SLACK_URL);
    });
  });
}

// Function to save Slack URL
function saveSlackUrl() {
  const slackUrl = document.getElementById('slack-url').value.trim();
  
  if (!slackUrl) {
    showNotice("Please enter a Slack URL.", 'error');
    return;
  }
  
  // Validate URL format
  if (!slackUrl.match(/^https:\/\/app\.slack\.com\/client\/[^\/]+\/[^\/]+$/)) {
    showNotice("Please enter a valid Slack URL in the format: https://app.slack.com/client/WORKSPACE/CHANNEL", 'error');
    return;
  }
  
  chrome.storage.local.set({ slackUrl: slackUrl }, () => {
    showNotice("Slack URL saved successfully!", 'success');
    updateCurrentSlackUrlDisplay();
    // Refresh username detection with new URL
    openConfiguredSlackChannel();
  });
}

// Function to update the current Slack URL display
function updateCurrentSlackUrlDisplay() {
  getConfiguredSlackUrl().then(url => {
    const displayElement = document.getElementById('current-slack-url');
    displayElement.innerHTML = `<a href="${url}" target="_blank">${url}</a>`;
  });
}

// Function to open the configured Slack channel and get the username
async function openConfiguredSlackChannel() {
  const SPECIFIC_SLACK_URL = await getConfiguredSlackUrl();
  
  // Check if the specific Slack channel is already open
  chrome.tabs.query({url: SPECIFIC_SLACK_URL}, (tabs) => {
    if (tabs.length > 0) {
      // The tab is already open, get username from it
      setTimeout(() => {
        getUsernameFromSpecificChannel(tabs[0].id);
      }, 1000);
    } else {
      // Check if any Slack tab is open
      chrome.tabs.query({url: "https://app.slack.com/*"}, (slackTabs) => {
        if (slackTabs.length > 0) {
          // Try to get username from existing Slack tab first
          getUsernameFromSpecificChannel(slackTabs[0].id);
          
          // Also update the tab to our specific URL for future checks
          chrome.tabs.update(slackTabs[0].id, {url: SPECIFIC_SLACK_URL});
        } else {
          // No Slack tabs open, create a new one
          chrome.tabs.create({url: SPECIFIC_SLACK_URL}, (tab) => {
            // Wait a moment for the new tab to load
            setTimeout(() => {
              getUsernameFromSpecificChannel(tab.id);
            }, 3000);
          });
        }
      });
    }
  });
}

// Function to get the username from the specific Slack channel
function getUsernameFromSpecificChannel(tabId) {
  const usernameDisplay = document.getElementById('username-display');
  
  // Update display to show we're fetching from specific channel
  usernameDisplay.textContent = 'Fetching username from configured Slack channel...';
  usernameDisplay.style.color = '#f0ad4e';
  
  // First check if user is logged in
  chrome.tabs.sendMessage(tabId, {action: "checkSlackLoginStatus"}, (response) => {
    // Check for runtime error which might indicate content script hasn't loaded
    const error = chrome.runtime.lastError;
    if (error) {
      usernameDisplay.textContent = 'Waiting for Slack to load...';
      usernameDisplay.style.color = '#f0ad4e';
      
      // Try again after a delay
      setTimeout(() => getUsernameFromSpecificChannel(tabId), 3000);
      return;
    }
    
    if (response && response.isLoginPage) {
      usernameDisplay.textContent = 'Please sign in to Slack first';
      usernameDisplay.style.color = '#d9534f';
      showNotice("Please sign in to Slack to detect your username", 'warning');
      return;
    }
    
    // If not on login page, try to get username
    chrome.tabs.sendMessage(tabId, {action: "getDetectedUsername"}, (response) => {
      if (response && response.userName && response.userName !== "Unknown") {
        usernameDisplay.textContent = response.userName;
        usernameDisplay.style.color = '#5cb85c';
        
        // Store the username in local storage for future reference
        chrome.storage.local.set({ 
          detectedUsername: response.userName,
          additionalUserNames: response.additionalUserNames || []
        });
        
        if (response.additionalUserNames && response.additionalUserNames.length > 0) {
          const additionalNames = document.createElement('div');
          additionalNames.style.fontSize = '0.8em';
          additionalNames.style.color = '#888';
          additionalNames.style.marginTop = '5px';
          additionalNames.textContent = 'Also checking for: ' + response.additionalUserNames.join(', ');
          usernameDisplay.appendChild(additionalNames);
        }
        
        showNotice("Username detected successfully!", 'success');
      } else {
        // Username detection failed or returned "Unknown"
        usernameDisplay.textContent = 'Username not detected - trying alternative methods...';
        usernameDisplay.style.color = '#f0ad4e';
        
        // Try to get from stored data first
        chrome.storage.local.get('detectedUsername', (data) => {
          if (data.detectedUsername && data.detectedUsername !== "Unknown") {
            usernameDisplay.textContent = data.detectedUsername + ' (cached)';
            usernameDisplay.style.color = '#5cb85c';
            showNotice("Using cached username. Open Slack to refresh detection.", 'info');
          } else {
            // Show manual input option
            showManualUsernameInput();
          }
        });
      }
    });
  });
}

// Function to show manual username input when detection fails
function showManualUsernameInput() {
  const usernameDisplay = document.getElementById('username-display');
  usernameDisplay.innerHTML = `
    <div style="margin-bottom: 10px;">
      <input type="text" id="manual-username" placeholder="Enter your Slack username" 
             style="width: 70%; padding: 5px; border: 1px solid #ddd; border-radius: 4px;">
      <button id="save-manual-username" 
              style="width: 25%; padding: 5px; background-color: #4A154B; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Save
      </button>
    </div>
    <div style="font-size: 0.8em; color: #666;">
      Username detection failed. Please enter manually.
    </div>
  `;
  
  // Add event listener for manual save
  document.getElementById('save-manual-username').addEventListener('click', () => {
    const manualUsername = document.getElementById('manual-username').value.trim();
    if (manualUsername) {
      chrome.storage.local.set({ 
        detectedUsername: manualUsername,
        additionalUserNames: [manualUsername.toLowerCase()]
      }, () => {
        usernameDisplay.textContent = manualUsername + ' (manual)';
        usernameDisplay.style.color = '#5cb85c';
        showNotice("Username saved manually!", 'success');
      });
    } else {
      showNotice("Please enter a username", 'error');
    }
  });
  
  // Add enter key support
  document.getElementById('manual-username').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('save-manual-username').click();
    }
  });
  
  showNotice("Username detection failed. Please enter your username manually.", 'warning', 5000);
}

// Function to enable Gemini
function useGemini() {
  chrome.storage.local.set({ 
    useGemini: true
  }, () => {
    document.getElementById('gemini-active').style.display = 'block';
    document.getElementById('gemini-available').style.display = 'none';
    document.getElementById('gemini-status-check').style.display = 'none';
    document.getElementById('api-settings').style.display = 'none';
    showNotice("Now using Gemini for AI responses!", 'success');
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
    showNotice("Stopped using Gemini. Please configure an API provider.", 'info');
  });
}

// Function to manually check for mentions
function checkForMentionsNow() {
  showNotice("Checking for mentions...", 'info');
  
  // First check if background script is responsive
  chrome.runtime.sendMessage({action: "ping"}, (response) => {
    if (chrome.runtime.lastError) {
      showNotice("Background script not responding. Try reloading the extension.", 'error');
      return;
    }
    
    // Background script is responsive, proceed with check
    chrome.runtime.sendMessage({action: "checkMentionsManually"}, (response) => {
      if (response && response.success) {
        // Reload mentions after a short delay to allow for processing
        setTimeout(() => {
          loadMentions();
          showNotice("Mention check completed!", 'success');
        }, 2000);
      } else {
        showNotice("Error checking mentions: " + (response ? response.error : "Unknown error"), 'error');
      }
    });
  });
}

// Load mentions from storage
function loadMentions() {
  chrome.storage.local.get('mentions', (data) => {
    const mentions = data.mentions || [];
    const container = document.getElementById('mentions-container');
    const noMentionsElement = document.getElementById('no-mentions');
    
    // Check if required elements exist
    if (!container) {
      console.log("Mentions container not found");
      return;
    }
    
    if (!noMentionsElement) {
      console.log("No mentions element not found");
      return;
    }
    
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
      
      // Add different styling based on mention type
      if (mention.isMention) {
        mentionElement.style.borderLeft = '4px solid #e01e5a'; // Red for direct mentions
      } else if (mention.isDM) {
        mentionElement.style.borderLeft = '4px solid #36c5f0'; // Blue for DMs
      }
      
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
              // Reload mentions and update badge
              loadMentions();
              updateBadge(updatedMentions.length);
            });
          });
        });
      }
      
      const textElement = document.createElement('div');
      textElement.className = 'mention-text';
      textElement.textContent = mention.text;
      
      // Add mention type indicator
      const typeElement = document.createElement('div');
      typeElement.style.fontSize = '0.7em';
      typeElement.style.color = '#666';
      typeElement.style.marginBottom = '5px';
      typeElement.style.fontWeight = 'bold';
      
      if (mention.isMention) {
        typeElement.textContent = '🔔 Direct Mention';
        typeElement.style.color = '#e01e5a';
      } else if (mention.isDM) {
        typeElement.textContent = '💬 Direct Message';
        typeElement.style.color = '#36c5f0';
      }
      
      // Add channel name if available
      if (mention.channelName) {
        const channelElement = document.createElement('div');
        channelElement.style.fontSize = '0.8em';
        channelElement.style.color = '#888';
        channelElement.style.marginBottom = '5px';
        channelElement.textContent = `#${mention.channelName}`;
        mentionElement.appendChild(channelElement);
      }
      
      const timestampElement = document.createElement('div');
      timestampElement.className = 'timestamp';
      timestampElement.textContent = formatTimestamp(mention.timestamp);
      
      const responsesElement = document.createElement('div');
      responsesElement.className = 'responses';
      
      // Add suggested responses for mentions and DMs only
      if (mention.suggestedResponses && mention.suggestedResponses.length > 0) {
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
      
      mentionElement.appendChild(typeElement);
      mentionElement.appendChild(textElement);
      mentionElement.appendChild(timestampElement);
      mentionElement.appendChild(responsesElement);
      
      container.appendChild(mentionElement);
    });
    
    if (mentions.length > 0) {
      const directMentions = mentions.filter(m => m.isMention).length;
      const directMessages = mentions.filter(m => m.isDM).length;
      
      let noticeText = `Found ${mentions.length} notification(s)`;
      if (directMentions > 0) noticeText += ` (${directMentions} mention${directMentions > 1 ? 's' : ''})`;
      if (directMessages > 0) noticeText += ` (${directMessages} DM${directMessages > 1 ? 's' : ''})`;
      
      showNotice(noticeText, 'info', 3000);
    }
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
      showNotice("Response sent!", 'success');
      
      // Remove the mention from storage
      chrome.storage.local.get('mentions', (data) => {
        const mentions = data.mentions || [];
        const updatedMentions = mentions.filter(m => m.threadId !== threadId);
        chrome.storage.local.set({ mentions: updatedMentions }, () => {
          // Reload mentions and update badge
          loadMentions();
          updateBadge(updatedMentions.length);
        });
      });
    } else {
      showNotice("No Slack tab is open. Please open Slack first.", 'error');
    }
  });
}

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get(['apiType', 'apiKey', 'useGemini', 'slackUrl'], (data) => {
    // Load API settings
    if (data.apiType) {
      document.getElementById('api-type').value = data.apiType;
    }
    if (data.apiKey) {
      document.getElementById('api-key').value = data.apiKey;
    }
    
    // Load Slack URL
    if (data.slackUrl) {
      document.getElementById('slack-url').value = data.slackUrl;
    } else {
      document.getElementById('slack-url').value = DEFAULT_SLACK_URL;
    }
    
    // Update current Slack URL display
    updateCurrentSlackUrlDisplay();
    
    // Check if Gemini is being used
    if (data.useGemini) {
      document.getElementById('gemini-active').style.display = 'block';
      document.getElementById('gemini-status-check').style.display = 'none';
      document.getElementById('gemini-available').style.display = 'none';
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
  const geminiStatusCheck = document.getElementById('gemini-status-check');
  const geminiStatusText = document.getElementById('gemini-status-text');
  const geminiAvailableDiv = document.getElementById('gemini-available');
  
  geminiStatusText.textContent = 'Checking for Gemini availability...';
  geminiStatusCheck.style.display = 'block';
  geminiAvailableDiv.style.display = 'none';
  
  // Debug: Log all tabs to help troubleshoot
  chrome.tabs.query({}, (allTabs) => {
    console.log('All open tabs:', allTabs.map(tab => ({ id: tab.id, url: tab.url, title: tab.title })));
    
    const geminiTabs = allTabs.filter(tab => 
      tab.url && tab.url.includes('gemini.google.com')
    );
    console.log('Gemini tabs found:', geminiTabs.map(tab => ({ id: tab.id, url: tab.url, title: tab.title })));
  });
  
  // Try multiple URL patterns to catch different Gemini URLs
  const geminiUrlPatterns = [
    "https://gemini.google.com/app/*",
    "https://gemini.google.com/*"
  ];
  
  let foundGemini = false;
  let checkedPatterns = 0;
  
  geminiUrlPatterns.forEach(pattern => {
    chrome.tabs.query({url: pattern}, (tabs) => {
      checkedPatterns++;
      console.log(`Pattern "${pattern}" found ${tabs.length} tabs:`, tabs.map(t => t.url));
      
      if (tabs.length > 0) {
        foundGemini = true;
        console.log(`Found ${tabs.length} Gemini tab(s) with pattern: ${pattern}`);
        
        // Gemini is available
        geminiStatusCheck.style.display = 'none';
        geminiAvailableDiv.style.display = 'block';
        showNotice("Gemini is available in another tab!", 'success', 2000);
      }
      
      // If this is the last pattern check and no Gemini found
      if (checkedPatterns === geminiUrlPatterns.length && !foundGemini) {
        // Also try a more general search for any tab with "gemini" in the URL
        chrome.tabs.query({}, (allTabs) => {
          const geminiTabs = allTabs.filter(tab => 
            tab.url && tab.url.includes('gemini.google.com')
          );
          
          if (geminiTabs.length > 0) {
            console.log(`Found ${geminiTabs.length} Gemini tab(s) via general search:`, geminiTabs.map(t => t.url));
            
            // Gemini is available
            geminiStatusCheck.style.display = 'none';
            geminiAvailableDiv.style.display = 'block';
            showNotice("Gemini is available in another tab!", 'success', 2000);
          } else {
            // Gemini is not available
            geminiStatusText.textContent = 'Gemini not available. Open Gemini in another tab to use it.';
            geminiStatusCheck.style.display = 'block';
            geminiAvailableDiv.style.display = 'none';
            
            // Show helpful link
            const helpLink = document.createElement('div');
            helpLink.innerHTML = '<a href="https://gemini.google.com/app" target="_blank" style="color: #4285F4; text-decoration: underline;">Open Gemini</a>';
            helpLink.style.marginTop = '5px';
            geminiStatusCheck.appendChild(helpLink);
          }
        });
      }
    });
  });
}

// Save API settings to storage
function saveApiSettings() {
  const apiType = document.getElementById('api-type').value;
  const apiKey = document.getElementById('api-key').value.trim();
  
  if (!apiKey) {
    showNotice("Please enter an API key.", 'error');
    return;
  }
  
  chrome.storage.local.set({ 
    apiType: apiType,
    apiKey: apiKey,
    useGemini: false
  }, () => {
    showNotice("API settings saved successfully!", 'success');
  });
}

// Function to update the extension badge
function updateBadge(count) {
  chrome.runtime.sendMessage({
    action: "updateBadge",
    count: count
  });
}

// Function to check background monitoring status
function checkBackgroundStatus() {
  const statusElement = document.getElementById('background-status');
  const statusText = document.getElementById('background-status-text');
  
  // Check if elements exist before accessing them
  if (!statusElement || !statusText) {
    console.log("Background status elements not found");
    return;
  }
  
  // Check if background script is responsive
  chrome.runtime.sendMessage({action: "ping"}, (response) => {
    if (chrome.runtime.lastError || !response) {
      statusText.textContent = "⚠️ Background monitoring inactive";
      statusElement.style.backgroundColor = '#fff3cd';
      statusElement.style.border = '1px solid #ffeaa7';
      statusElement.style.color = '#856404';
    } else {
      // Check if alarms are active
      chrome.alarms.getAll((alarms) => {
        const hasSlackAlarm = alarms.some(alarm => alarm.name === 'checkSlackMentions');
        if (hasSlackAlarm) {
          statusText.textContent = "✅ Background monitoring active";
          statusElement.style.backgroundColor = '#d4edda';
          statusElement.style.border = '1px solid #c3e6cb';
          statusElement.style.color = '#155724';
        } else {
          statusText.textContent = "⚠️ Background alarms not found";
          statusElement.style.backgroundColor = '#fff3cd';
          statusElement.style.border = '1px solid #ffeaa7';
          statusElement.style.color = '#856404';
        }
      });
    }
  });
}