export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY);
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);

  return res.status(200).json({
    status: "ok",
    mode: "cloud",
    gemini: {
      configured: geminiConfigured,
      masked: geminiConfigured ? "CONFIGURED" : "NOT_SET"
    },
    openai: {
      configured: openaiConfigured,
      masked: openaiConfigured ? "CONFIGURED" : "NOT_SET"
    }
  });
}
