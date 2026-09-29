require("dotenv").config();

const { WebClient } = require("@slack/web-api");

console.log("SLACK_BOT_TOKEN:", process.env.SLACK_BOT_TOKEN);
console.log("SLACK_CHANNEL_ID:", process.env.SLACK_CHANNEL_ID);

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

async function sendTestMessage() {
    try {
        const result = await slack.chat.postMessage({
            channel: process.env.SLACK_CHANNEL_ID,
            text: "🚀 GitHub Automation Bot is working!"
        });

        console.log("Slack message sent:", result.ts);
    } catch (error) {
        console.error("Slack error:", error);
    }
}

sendTestMessage();