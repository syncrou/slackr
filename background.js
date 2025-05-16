// Set up alarm for periodic checking
chrome.runtime.onInstalled.addListener(() => {
  // Check every 5 minutes
  chrome.alarms.create('checkSlackMentions', { periodInMinutes: 5 });
  
  // Initialize storage
  chrome.storage.local.set({ 
    mentions: [],
    apiType: "openai",
    apiKey: "",
    useGemini: false
    // No hardcoded workspace or channel IDs - will be detected dynamically
  });
});

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkSlackMentions') {
    checkForMentions();
  }
});

// Function to check for mentions
function checkForMentions() {
  chrome.tabs.query({url: "https://app.slack.com/*"}, (tabs) => {
    if (tabs.length > 0) {
      console.log("Found Slack tabs:", tabs.length);
      
      // First, get workspace/channel info from the first active Slack tab
      try {
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
          scanAllSlackTabs(tabs);
        });
      } catch (e) {
        console.log("Exception getting workspace info:", e.message);
        // Still try to scan tabs even if getting workspace info fails
        scanAllSlackTabs(tabs);
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
      // We don't expect a response from the content script for checkMentions
      // so don't provide a callback - this avoids the "message channel closed" error
      chrome.tabs.sendMessage(tab.id, {action: "checkMentions"});
      
      // Log any runtime error that might occur, but don't wait for a response
      const error = chrome.runtime.lastError;
      if (error) {
        console.log("Error sending message to tab (non-blocking):", error.message || "Unknown error");
      }
    } catch (e) {
      console.log("Exception when sending message to tab:", e.message);
    }
  });
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkMentionsManually") {
    checkForMentions();
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
    // Create notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: 'New Mention in Slack',
      message: `You were mentioned in a conversation: "${message.text.substring(0, 100)}..."`,
      buttons: [
        { title: 'View' }
      ],
      priority: 2
    });
    
    // Store the mention and generate responses asynchronously
    (async () => {
      // Only generate responses if it's an actual mention, not just an unread message
      const responses = message.isMention ? await generateResponses(message.text) : [];
      
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
          suggestedResponses: responses
        });
        chrome.storage.local.set({ mentions: mentions });
      });
    })();
  }
  
  // We need to return true to indicate we'll respond asynchronously
  return true;
});

// Generate suggested responses based on message content
async function generateResponses(text) {
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
    // Find Gemini tabs
    chrome.tabs.query({url: "https://gemini.google.com/app/*"}, (tabs) => {
      if (tabs.length === 0) {
        reject(new Error("No Gemini tab found. Please open Gemini in another tab."));
        return;
      }
      
      // Send message to the first Gemini tab
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "getGeminiResponses",
        text: `Generate 4 different brief responses to this Slack message where I was mentioned: "${text}". Each response should be concise (under 100 characters) and appropriate for a workplace setting. Format each response on a new line with a number.`
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("Error communicating with Gemini tab: " + chrome.runtime.lastError.message));
          return;
        }
        
        if (response && response.responses) {
          resolve(response.responses);
        } else {
          reject(new Error("Invalid response from Gemini tab"));
        }
      });
    });
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
          role: 'system',
          content: 'You are an assistant helping to generate 4 brief, professional responses to a Slack message where the user was mentioned. Each response should be concise (under 100 characters) and appropriate for a workplace setting.'
        },
        {
          role: 'user',
          content: `Generate 4 different brief responses to this Slack message where I was mentioned: "${text}"`
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
          content: `Generate 4 different brief responses to this Slack message where I was mentioned: "${text}". Each response should be concise (under 100 characters) and appropriate for a workplace setting. Format each response on a new line with a number.`
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
