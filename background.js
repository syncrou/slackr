// Set up alarm for periodic checking
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated - setting up monitoring");
  setupPeriodicChecking();
  
  // Initialize storage
  chrome.storage.local.set({ 
    mentions: [],
    apiType: "openai",
    apiKey: "",
    useGemini: false,
    enhancedDetection: true // Default to enabled for better detection
    // No hardcoded workspace or channel IDs - will be detected dynamically
  });
});

// Also set up monitoring when the service worker starts up
chrome.runtime.onStartup.addListener(() => {
  console.log("Chrome started - resuming monitoring");
  setupPeriodicChecking();
});

// Function to set up periodic checking
function setupPeriodicChecking() {
  // Clear any existing alarms first
  chrome.alarms.clear('checkSlackMentions');
  
  // Check every 2 minutes (reduced from 5 for more responsive monitoring)
  chrome.alarms.create('checkSlackMentions', { periodInMinutes: 2 });
  console.log("Periodic checking alarm created (every 2 minutes)");
  
  // Do an immediate check
  setTimeout(checkForMentions, 2000);
}

// Keep the service worker alive by periodically checking alarms
setInterval(() => {
  chrome.alarms.get('checkSlackMentions', (alarm) => {
    if (!alarm) {
      console.log("Alarm was lost, recreating...");
      setupPeriodicChecking();
    }
  });
}, 60000); // Check every minute

// Check for mentions when Slack tabs become active
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url && tab.url.includes('slack.com')) {
      console.log("Slack tab activated - checking mentions");
      checkForMentions();
    }
  });
});

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkSlackMentions') {
    // Check if enhanced detection is enabled
    chrome.storage.local.get('enhancedDetection', (data) => {
      const useEnhanced = data.enhancedDetection !== false; // Default to true
      
      if (useEnhanced) {
        console.log("Background check triggered - using enhanced detection");
        checkForMentions(true); // Use enhanced activation for background checks
      } else {
        console.log("Background check triggered - using standard detection");
        checkForMentions(false); // Use standard detection
      }
    });
  }
});

// Function to check for mentions
function checkForMentions(useActivation = false) {
  chrome.tabs.query({url: "https://app.slack.com/*"}, (tabs) => {
    if (tabs.length > 0) {
      console.log("Found Slack tabs:", tabs.length);
      
      // First, get workspace/channel info from the first active Slack tab
      try {
        // Check if content script is ready first
        chrome.tabs.sendMessage(tabs[0].id, {action: "ping"}, (pingResponse) => {
          if (chrome.runtime.lastError) {
            console.log("Content script not ready, injecting and retrying...");
            injectContentScriptIfNeeded(tabs[0].id, 'content.js');
            // Continue with scanning other tabs
            if (useActivation) {
              scanAllSlackTabsWithActivation(tabs);
            } else {
              scanAllSlackTabs(tabs);
            }
            return;
          }
          
          // Content script is ready, get workspace info
          chrome.tabs.sendMessage(tabs[0].id, {action: "getWorkspaceInfo"}, (response) => {
            // Handle any runtime error
            if (chrome.runtime.lastError) {
              console.log("Error getting workspace info:", chrome.runtime.lastError.message);
            } else if (response && response.workspaceId) {
              console.log(`Got workspace info: ${response.workspaceId}/${response.channelId}`);
              
              // Store the workspace/channel info for future use
              chrome.storage.local.set({
                currentWorkspaceId: response.workspaceId,
                currentChannelId: response.channelId
              });
            }
            
            // Continue with sending checkMentions to all tabs
            if (useActivation) {
              console.log("Using enhanced tab activation for better detection...");
              scanAllSlackTabsWithActivation(tabs);
            } else {
              scanAllSlackTabs(tabs);
            }
          });
        });
      } catch (e) {
        console.log("Exception getting workspace info:", e.message);
        // Still try to scan tabs even if getting workspace info fails
        if (useActivation) {
          scanAllSlackTabsWithActivation(tabs);
        } else {
          scanAllSlackTabs(tabs);
        }
      }
    } else {
      console.log("No Slack tabs found");
    }
  });
}

// Helper function to scan all Slack tabs for mentions
function scanAllSlackTabs(tabs) {
  // Send message to all Slack tabs - using a fire-and-forget approach for checkMentions
  tabs.forEach(tab => {
    try {
      // Check if tab is ready and content script is loaded
      chrome.tabs.sendMessage(tab.id, {action: "ping"}, (response) => {
        if (chrome.runtime.lastError) {
          console.log(`Tab ${tab.id} content script not ready:`, chrome.runtime.lastError.message);
          // Try to inject content script if it's not loaded
          if (tab.url && tab.url.includes('slack.com')) {
            injectContentScriptIfNeeded(tab.id, 'content.js');
          }
        } else {
          // Content script is ready, send the actual message
          chrome.tabs.sendMessage(tab.id, {action: "checkMentions"}, () => {
            // Ignore any response errors for this fire-and-forget message
            if (chrome.runtime.lastError) {
              console.log(`Non-critical error sending checkMentions to tab ${tab.id}:`, chrome.runtime.lastError.message);
            }
          });
        }
      });
    } catch (e) {
      console.log("Exception when sending message to tab:", e.message);
    }
  });
}

// Enhanced function to scan Slack tabs with activation for better detection
function scanAllSlackTabsWithActivation(tabs) {
  if (tabs.length === 0) return;
  
  // Get the currently active tab to restore it later
  chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
    const originalActiveTab = activeTabs.length > 0 ? activeTabs[0] : null;
    
    // Process each Slack tab sequentially
    let tabIndex = 0;
    
    function processNextTab() {
      if (tabIndex >= tabs.length) {
        // Restore original active tab
        if (originalActiveTab && originalActiveTab.id !== tabs[0].id) {
          chrome.tabs.update(originalActiveTab.id, {active: true}).catch(() => {
            // Ignore errors if we can't restore the original tab
          });
        }
        return;
      }
      
      const tab = tabs[tabIndex];
      
      try {
        // Check if content script is ready
        chrome.tabs.sendMessage(tab.id, {action: "ping"}, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`Tab ${tab.id} content script not ready:`, chrome.runtime.lastError.message);
            if (tab.url && tab.url.includes('slack.com')) {
              injectContentScriptIfNeeded(tab.id, 'content.js');
            }
            tabIndex++;
            processNextTab();
          } else {
            // Briefly activate the tab to force Slack to refresh
            chrome.tabs.update(tab.id, {active: true}, () => {
              if (chrome.runtime.lastError) {
                console.log(`Could not activate tab ${tab.id}:`, chrome.runtime.lastError.message);
                tabIndex++;
                processNextTab();
                return;
              }
              
              // Wait a moment for Slack to update, then check mentions
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, {action: "checkMentions"}, () => {
                  if (chrome.runtime.lastError) {
                    console.log(`Non-critical error sending checkMentions to tab ${tab.id}:`, chrome.runtime.lastError.message);
                  }
                  
                  // Move to next tab after a short delay
                  tabIndex++;
                  setTimeout(processNextTab, 500);
                });
              }, 1000);
            });
          }
        });
      } catch (e) {
        console.log("Exception when processing tab:", e.message);
        tabIndex++;
        processNextTab();
      }
    }
    
    // Start processing tabs
    processNextTab();
  });
}

// Function to inject content script if needed
function injectContentScriptIfNeeded(tabId, scriptFile) {
  try {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [scriptFile]
    }, () => {
      if (chrome.runtime.lastError) {
        console.log(`Could not inject ${scriptFile}:`, chrome.runtime.lastError.message);
      } else {
        console.log(`Successfully injected ${scriptFile} into tab ${tabId}`);
        // Wait a bit then try sending the message again
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {action: "checkMentions"}, () => {
            if (chrome.runtime.lastError) {
              console.log(`Still couldn't communicate after injection:`, chrome.runtime.lastError.message);
            }
          });
        }, 1000);
      }
    });
  } catch (e) {
    console.log("Exception injecting content script:", e.message);
  }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({success: true, timestamp: Date.now()});
    return true;
  }
  else if (message.action === "checkMentionsManually") {
    console.log("Manual mention check requested");
    checkForMentions();
    sendResponse({success: true});
    return true;
  }
  else if (message.action === "updateBadge") {
    updateBadge(message.count);
    sendResponse({success: true});
    return true;
  }
  else if (message.action === "workspaceInfoUpdate") {
    // Store the workspace and channel info from the content script
    console.log("Received workspace info update:", message.workspaceId, message.channelId);
    chrome.storage.local.set({
      currentWorkspaceId: message.workspaceId,
      currentChannelId: message.channelId
    });
    sendResponse({success: true});
    return true;
  }
  else if (message.action === "mentionFound") {
    // Create notification with appropriate title based on type
    let notificationTitle = 'New Mention in Slack';
    let notificationMessage = `You were mentioned in a conversation: "${message.text.substring(0, 100)}..."`;
    
    if (message.isDM) {
      notificationTitle = 'New Direct Message in Slack';
      notificationMessage = `New direct message: "${message.text.substring(0, 100)}..."`;
    }
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: notificationTitle,
      message: notificationMessage,
      buttons: [
        { title: 'View' }
      ],
      priority: 2
    });
    
    // Store the mention and generate responses asynchronously
    (async () => {
      try {
        // Generate responses for mentions and DMs only
        const responses = await generateResponses(message.text, false, null);
        
        // Check if this message ID already exists in storage
        chrome.storage.local.get('mentions', (data) => {
          const mentions = data.mentions || [];
          
          // Check if this message already exists
          const existingIndex = mentions.findIndex(m => m.id === message.id);
          if (existingIndex >= 0) {
            console.log("Message already exists in storage, skipping");
            return;
          }
          
          mentions.push({
            id: message.id,
            text: message.text,
            timestamp: new Date().toISOString(),
            threadId: message.threadId,
            channelId: message.channelId,
            messageUrl: message.messageUrl || null,
            isMention: message.isMention || false,
            isDM: message.isDM || false,
            channelName: message.channelName || null,
            suggestedResponses: responses
          });
          chrome.storage.local.set({ mentions: mentions }, () => {
            // Update badge with unread count
            updateBadge(mentions.length);
          });
        });
      } catch (error) {
        console.error("Error in mentionFound handler:", error);
        // Still store the mention without responses
        chrome.storage.local.get('mentions', (data) => {
          const mentions = data.mentions || [];
          
          // Check if this message already exists
          const existingIndex = mentions.findIndex(m => m.id === message.id);
          if (existingIndex >= 0) {
            console.log("Message already exists in storage, skipping");
            return;
          }
          
          mentions.push({
            id: message.id,
            text: message.text,
            timestamp: new Date().toISOString(),
            threadId: message.threadId,
            channelId: message.channelId,
            messageUrl: message.messageUrl || null,
            isMention: message.isMention || false,
            isDM: message.isDM || false,
            channelName: message.channelName || null,
            suggestedResponses: []
          });
          chrome.storage.local.set({ mentions: mentions }, () => {
            // Update badge with unread count
            updateBadge(mentions.length);
          });
        });
      }
    })();
  }
  
  // We need to return true to indicate we'll respond asynchronously
  return true;
});

// Generate suggested responses based on message content
async function generateResponses(text, isChannelActivity = false, channelName = null) {
  // First check if we have API keys configured
  const data = await chrome.storage.local.get(['apiType', 'apiKey', 'useGemini']);
  
  // If Gemini is enabled, use it regardless of API key
  if (data.useGemini) {
    try {
      const responses = await getGeminiResponses(text);
      return responses;
    } catch (error) {
      console.error("Error generating Gemini responses:", error);
      // Fall back to default responses
      return getDefaultResponses();
    }
  }
  
  if (!data.apiKey) {
    // Fall back to default responses if no API key is set
    return getDefaultResponses();
  }
  
  try {
    // Get AI-generated responses
    const responses = await getAIResponses(text, data.apiType, data.apiKey);
    return responses;
  } catch (error) {
    console.error("Error generating AI responses:", error);
    // Fall back to default responses on error
    return getDefaultResponses();
  }
}

// Default responses when no API is available
function getDefaultResponses() {
  return [
    "Thanks for the mention. I'll look into this.",
    "I appreciate you bringing this to my attention.",
    "I'll review this and get back to you shortly.",
    "Thanks for the update. Let me check on this."
  ];
}

// Function to get AI-generated responses
async function getAIResponses(text, apiType, apiKey) {
  if (apiType === 'openai') {
    return await getOpenAIResponses(text, apiKey);
  } else if (apiType === 'claude') {
    return await getClaudeResponses(text, apiKey);
  } else if (apiType === 'gemini') {
    // For Gemini, we'll use the browser tab directly
    return await getGeminiResponses(text);
  } else {
    throw new Error("Unknown API type");
  }
}

// Get responses from Gemini by sending a message to the content script in the Gemini tab
async function getGeminiResponses(text) {
  return new Promise((resolve, reject) => {
    // Try multiple URL patterns to find Gemini tabs
    const geminiUrlPatterns = [
      "https://gemini.google.com/app/*",
      "https://gemini.google.com/*"
    ];
    
    let foundGemini = false;
    let checkedPatterns = 0;
    
    geminiUrlPatterns.forEach(pattern => {
      chrome.tabs.query({url: pattern}, (tabs) => {
        checkedPatterns++;
        
        if (tabs.length > 0 && !foundGemini) {
          foundGemini = true;
          console.log(`Found ${tabs.length} Gemini tab(s) with pattern: ${pattern}`);
          
          // Check if Gemini content script is ready
          chrome.tabs.sendMessage(tabs[0].id, {action: "ping"}, (pingResponse) => {
            if (chrome.runtime.lastError) {
              console.log("Gemini content script not ready, injecting...");
              injectContentScriptIfNeeded(tabs[0].id, 'gemini-content.js');
              setTimeout(() => {
                // Try again after injection
                sendGeminiRequest(tabs[0].id, text, resolve, reject);
              }, 2000);
            } else {
              // Content script is ready
              sendGeminiRequest(tabs[0].id, text, resolve, reject);
            }
          });
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
              
              // Check if Gemini content script is ready
              chrome.tabs.sendMessage(geminiTabs[0].id, {action: "ping"}, (pingResponse) => {
                if (chrome.runtime.lastError) {
                  console.log("Gemini content script not ready, injecting...");
                  injectContentScriptIfNeeded(geminiTabs[0].id, 'gemini-content.js');
                  setTimeout(() => {
                    // Try again after injection
                    sendGeminiRequest(geminiTabs[0].id, text, resolve, reject);
                  }, 2000);
                } else {
                  // Content script is ready
                  sendGeminiRequest(geminiTabs[0].id, text, resolve, reject);
                }
              });
            } else {
              reject(new Error("No Gemini tab found. Please open Gemini in another tab."));
            }
          });
        }
      });
    });
  });
}

// Helper function to send Gemini request
function sendGeminiRequest(tabId, text, resolve, reject) {
  chrome.tabs.sendMessage(tabId, {
    action: "getGeminiResponses",
    text: `Generate 4 different brief responses to this Slack message where I was mentioned: "${text}". Each response should be concise (under 100 characters) and appropriate for a workplace setting. Format each response on a new line with a number.`,
  }, (response) => {
    if (chrome.runtime.lastError) {
      reject(new Error("Error communicating with Gemini tab: " + chrome.runtime.lastError.message));
      return;
    }
    
    if (response && response.responses) {
      resolve(response.responses);
    } else if (response && response.error) {
      reject(new Error("Gemini error: " + response.error));
    } else {
      reject(new Error("Invalid response from Gemini tab"));
    }
  });
}

// Get responses from OpenAI
async function getOpenAIResponses(text, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    })
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${data.error?.message || 'Unknown error'}`);
  }
  
  // Parse the response to extract the 4 suggestions
  const content = data.choices[0].message.content;
  // Split by numbers or newlines to get individual responses
  const responses = content.split(/\d+\.\s|\n+/).filter(line => line.trim().length > 0);
  
  // Return up to 4 responses
  return responses.slice(0, 4);
}

// Get responses from Claude
async function getClaudeResponses(text, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: text
        }
      ]
    })
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Claude API error: ${data.error?.message || 'Unknown error'}`);
  }
  
  // Parse the response to extract the 4 suggestions
  const content = data.content[0].text;
  // Split by numbers or newlines to get individual responses
  const responses = content.split(/\d+\.\s|\n+/).filter(line => line.trim().length > 0);
  
  // Return up to 4 responses
  return responses.slice(0, 4);
}

// Function to update the extension badge
function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({
      text: count.toString()
    });
    chrome.action.setBadgeBackgroundColor({color: '#FF0000'});
  } else {
    chrome.action.setBadgeText({text: ''});
  }
}

// Update badge when extension starts
chrome.storage.local.get('mentions', (data) => {
  const mentions = data.mentions || [];
  updateBadge(mentions.length);
});
