// Content script that runs in the context of the Gemini page
console.log("Gemini content script loaded");

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({success: true, timestamp: Date.now()});
    return true;
  }
  else if (message.action === "getGeminiResponses") {
    console.log("Received request for Gemini responses");
    console.log("Message text:", message.text);
    
    getGeminiResponses(message.text)
      .then(responses => {
        console.log("Gemini responses generated:", responses);
        sendResponse({ responses: responses });
      })
      .catch(error => {
        console.error("Error generating Gemini responses:", error);
        sendResponse({ error: error.message });
      });
      
    return true; // Indicates we'll send a response asynchronously
  }
});

// Function to interact with Gemini
async function getGeminiResponses(text) {
  try {
    // Find the textarea input
    const textarea = document.querySelector('textarea');
    if (!textarea) {
      throw new Error("Couldn't find Gemini input field");
    }
    
    // Clear any existing text
    textarea.value = '';
    
    // Set the prompt text
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Find and click the send button
    const sendButton = document.querySelector('button[aria-label="Send message"]') || 
                       document.querySelector('button[aria-label="Submit"]') ||
                       Array.from(document.querySelectorAll('button')).find(b => 
                         b.textContent.includes('Send') || 
                         b.querySelector('svg[aria-label="Send message"]'));
    
    if (!sendButton) {
      throw new Error("Couldn't find Gemini send button");
    }
    
    // Click the send button
    sendButton.click();
    
    // Wait for the response
    await waitForGeminiResponse();
    
    // Extract the response text
    const responseElements = document.querySelectorAll('[role="region"][aria-label*="Gemini"]');
    if (responseElements.length === 0) {
      throw new Error("Couldn't find Gemini response");
    }
    
    // Get the latest response
    const latestResponse = responseElements[responseElements.length - 1];
    const responseText = latestResponse.textContent;
    
    // Parse the response to extract the 4 suggestions
    const responses = parseResponses(responseText);
    
    // Return up to 4 responses
    return responses.slice(0, 4);
  } catch (error) {
    console.error("Error getting Gemini responses:", error);
    throw error;
  }
}

// Function to wait for Gemini to respond
function waitForGeminiResponse() {
  return new Promise((resolve, reject) => {
    // Look for indicators that Gemini is thinking
    const checkForResponse = () => {
      const thinkingIndicator = document.querySelector('[aria-label="Gemini is thinking"]') ||
                               document.querySelector('[aria-label="Stop generating"]');
      
      if (thinkingIndicator) {
        // Gemini is still thinking, check again in a moment
        setTimeout(checkForResponse, 500);
      } else {
        // Gemini has finished responding
        setTimeout(resolve, 1000); // Give a little extra time for the UI to update
      }
    };
    
    // Start checking
    setTimeout(checkForResponse, 1000);
    
    // Set a timeout to prevent hanging
    setTimeout(() => {
      reject(new Error("Timed out waiting for Gemini response"));
    }, 30000);
  });
}

// Function to parse responses from Gemini's output
function parseResponses(text) {
  // Try to find numbered responses (1. 2. 3. 4.)
  const numberedResponses = text.split(/\d+\.\s+/).filter(line => line.trim().length > 0);
  
  if (numberedResponses.length >= 2) {
    return numberedResponses.map(r => r.trim());
  }
  
  // If that fails, try to split by newlines
  const lineResponses = text.split(/\n+/).filter(line => line.trim().length > 0);
  
  if (lineResponses.length >= 2) {
    return lineResponses.map(r => r.trim());
  }
  
  // If all else fails, just return the whole text as one response
  return [text.trim()];
}
