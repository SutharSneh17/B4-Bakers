// Utility script: prompts for Twilio credentials and writes validated values to .env.
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const envPath = path.resolve(process.cwd(), ".env");

// Parses KEY=VALUE lines into a map for easy updates.
function parseEnv(content) {
  const lines = String(content || "").split(/\r?\n/);
  const map = new Map();
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }
  return map;
}

function toEnvText(map) {
  const orderedKeys = [
    "PORT",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_VERIFY_SERVICE_SID",
  ];

  const out = [];
  for (const key of orderedKeys) {
    if (map.has(key)) {
      out.push(`${key}=${map.get(key)}`);
    }
  }

  for (const [key, value] of map.entries()) {
    if (!orderedKeys.includes(key)) {
      out.push(`${key}=${value}`);
    }
  }

  return out.join("\n") + "\n";
}

function validateAccountSid(value) {
  return /^AC[0-9a-f]{32}$/i.test(value);
}

function validateVerifySid(value) {
  return /^VA[0-9a-f]{32}$/i.test(value);
}

function validateAuthToken(value) {
  return typeof value === "string" && value.length >= 16 && !value.startsWith("your_");
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

// Interactive setup flow for local development credentials.
async function main() {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const envMap = parseEnv(existing);

  if (!envMap.has("PORT")) {
    envMap.set("PORT", "3000");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    let accountSid = "";
    while (!validateAccountSid(accountSid)) {
      accountSid = await ask(rl, "Enter TWILIO_ACCOUNT_SID (starts with AC): ");
      if (!validateAccountSid(accountSid)) {
        console.log("Invalid Account SID format.");
      }
    }

    let authToken = "";
    while (!validateAuthToken(authToken)) {
      authToken = await ask(rl, "Enter TWILIO_AUTH_TOKEN: ");
      if (!validateAuthToken(authToken)) {
        console.log("Invalid auth token.");
      }
    }

    let verifySid = "";
    while (!validateVerifySid(verifySid)) {
      verifySid = await ask(rl, "Enter TWILIO_VERIFY_SERVICE_SID (starts with VA): ");
      if (!validateVerifySid(verifySid)) {
        console.log("Invalid Verify Service SID format.");
      }
    }

    envMap.set("TWILIO_ACCOUNT_SID", accountSid);
    envMap.set("TWILIO_AUTH_TOKEN", authToken);
    envMap.set("TWILIO_VERIFY_SERVICE_SID", verifySid);

    fs.writeFileSync(envPath, toEnvText(envMap), "utf8");
    console.log(`.env updated at ${envPath}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Failed to setup Twilio env:", error.message);
  process.exit(1);
});

