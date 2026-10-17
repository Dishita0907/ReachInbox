import nodemailer from "nodemailer";
import { readFileSync, appendFileSync } from "node:fs";

const envPath = new URL("../.env", import.meta.url);

async function setupEthereal() {
  const envContent = readFileSync(envPath, "utf8");

  function getEnvValue(key: string): string {
    const match = envContent.match(
      new RegExp(`^${key}=(.*)$`, "m")
    );

    return match?.[1]?.trim() ?? "";
  }

  let username = getEnvValue("ETHEREAL_USER");
  let password = getEnvValue("ETHEREAL_PASS");

  if (Boolean(username) !== Boolean(password)) {
    throw new Error(
      "Incomplete Ethereal credentials in .env"
    );
  }

  if (!username) {
    console.log("Creating Ethereal test account...");

    const account = await nodemailer.createTestAccount();

    username = account.user;
    password = account.pass;

    const separator = envContent.endsWith("\n") ? "" : "\n";

    appendFileSync(
      envPath,
      separator +
      "\n# Ethereal test SMTP credentials\n" +
      `ETHEREAL_USER=${username}\n` +
      `ETHEREAL_PASS=${password}\n`
    );

    console.log("Ethereal credentials saved to backend/.env");
  } else {
    console.log("Using existing Ethereal credentials.");
  }

  // Connect to Ethereal using SMTP
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
    await transporter.verify();

    console.log("SMTP connection successful!");
    console.log("SMTP authentication successful!");
    console.log("No email has been sent.");
  } finally {
    transporter.close();
  }
}

setupEthereal().catch((error) => {
  console.error(
    "Ethereal setup failed:",
    error instanceof Error ? error.message : error
  );

  process.exitCode = 1;
});
