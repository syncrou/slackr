// Set up alarm for periodic checking
chrome.runtime.onInstalled.addListener(() => {
  // Check every 5 minutes
  chrome.alarms.create('checkSlackMentions', { periodInMinutes: 5 });
  
  // Initialize storage
  chrome.storage.local.set({ 
    mentions: [],
    workspaceId: "E030G10V24F",
    channelId: "C027F3GAQ",
    apiType: "openai",
    apiKey: ""
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
      // Send message to all Slack tabs
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {action: "checkMentions"}, response => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.log("Error sending message to tab:", error);
          }
        });
      });
    } else {
      console.log("No Slack tabs found");
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
  if (message.action === "mentionFound") {
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
      const responses = await generateResponses(message.text);
      
      chrome.storage.local.get('mentions', (data) => {
        const mentions = data.mentions || [];
        mentions.push({
          id: message.id,
          text: message.text,
          timestamp: new Date().toISOString(),
          threadId: message.threadId,
          channelId: message.channelId,
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
  const data = await chrome.storage.local.get(['apiType', 'apiKey']);
  
  if (!data.apiKey) {
    // Fall back to default responses if no API key is set
    return [
      "Thanks for the mention. I'll look into this.",
      "I appreciate you bringing this to my attention.",
      "I'll review this and get back to you shortly.",
      "Thanks for the update. Let me check on this."
    ];
  }
  
  try {
    // Get AI-generated responses
    const responses = await getAIResponses(text, data.apiType, data.apiKey);
    return responses;
  } catch (error) {
    console.error("Error generating AI responses:", error);
    // Fall back to default responses on error
    return [
      "Thanks for the mention. I'll look into this.",
      "I appreciate you bringing this to my attention.",
      "I'll review this and get back to you shortly.",
      "Thanks for the update. Let me check on this."
    ];
  }
}

// Function to get AI-generated responses
async function getAIResponses(text, apiType, apiKey) {
  if (apiType === 'openai') {
    return await getOpenAIResponses(text, apiKey);
  } else if (apiType === 'claude') {
    return await getClaudeResponses(text, apiKey);
  } else {
    throw new Error("Unknown API type");
  }
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
