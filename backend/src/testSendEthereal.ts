import "dotenv/config";
import nodemailer from "nodemailer";

async function sendTestEmail() {
  const username = process.env.ETHEREAL_USER;
  const password = process.env.ETHEREAL_PASS;

  if (!username || !password) {
    throw new Error(
      "Ethereal credentials are missing from .env"
    );
  }

  // Step 1: Configure Ethereal SMTP
  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: username,
      pass: password
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000
  });

  try {
    console.log("Connecting to Ethereal SMTP...");

    // Step 2: Prepare and send one test email
    const info = await transporter.sendMail({
      from: `"ReachInbox SMTP Test" <${username}>`,
      to: "recipient@example.test",
      subject: "ReachInbox - First SMTP Test",
      text: "Hello! This is my first test email using Ethereal SMTP.",
      html: `
        <h2>Hello from ReachInbox!</h2>
        <p>This is my first test email.</p>
        <p>Ethereal SMTP is working successfully.</p>
      `
    });

    // Step 3: Display the result
    console.log("Email accepted by Ethereal!");
    console.log("Message ID:", info.messageId);

    // Step 4: Generate preview URL
    const previewUrl = nodemailer.getTestMessageUrl(info);

    if (previewUrl) {
      console.log("Preview URL:", previewUrl);
    } else {
      console.log("Preview URL unavailable.");
    }

    console.log("Test completed.");
  } finally {
    transporter.close();
  }
}

sendTestEmail().catch((error) => {
  console.error(
    "Email test failed:",
    error instanceof Error ? error.message : error
  );

  process.exitCode = 1;
});
