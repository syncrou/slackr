// Set up alarm for periodic checking
chrome.runtime.onInstalled.addListener(() => {
  // Check every 5 minutes
  chrome.alarms.create('checkSlackMentions', { periodInMinutes: 5 });
  
  // Initialize storage
  chrome.storage.local.set({ 
    mentions: [],
    userName: "Drew Bomhof",
    workspaceId: "E030G10V24F",
    channelId: "C027F3GAQ"
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
  chrome.tabs.query({url: "https://app.slack.com/client/*/C*"}, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "checkMentions"});
    } else {
      console.log("No Slack tabs found");
    }
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    
    // Store the mention
    chrome.storage.local.get('mentions', (data) => {
      const mentions = data.mentions || [];
      mentions.push({
        id: message.id,
        text: message.text,
        timestamp: new Date().toISOString(),
        threadId: message.threadId,
        channelId: message.channelId,
        suggestedResponses: generateResponses(message.text)
      });
      chrome.storage.local.set({ mentions: mentions });
    });
  }
});

// Generate suggested responses based on message content
function generateResponses(text) {
  const responses = [
    "Thanks for the mention. I'll look into this.",
    "I appreciate you bringing this to my attention.",
    "I'll review this and get back to you shortly.",
    "Thanks for the update. Let me check on this."
  ];
  
  // In a real implementation, you might use more sophisticated logic
  // to generate contextual responses based on the message content
  
  return responses;
}
