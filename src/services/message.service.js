const processedMessages = new Set();

export const processMessage = async (messaging) => {
  const messageId = messaging.message.mid;
  const senderId = messaging.sender.id;
  const text = messaging.message.text;

  if (processedMessages.has(messageId)) {
    return;
  }

  processedMessages.add(messageId);

  console.log("📩 New DM:", text);

  if (text?.toLowerCase() === 'upload') {
    console.log(`🚀 Trigger upload for ${senderId}`);

    // 👉 Your upload logic here
  }
};