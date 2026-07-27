import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not set in Vercel Environment Variables. Please set GEMINI_API_KEY in your Vercel Project Settings."
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const chat = ai.chats.create({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction:
          "You are F.R.I.D.A.Y. (Fully Responsive Intelligence Defense Array Youngster). You are an advanced AI assistant with a professional, slightly witty, and highly capable personality, similar to Tony Stark's AI assistant. Your goal is to assist the user with intelligence and precision.",
      },
    });

    const result = await chat.sendMessage({ message });
    return res.status(200).json({ text: result.text });
  } catch (error) {
    console.error("Vercel Chat API Error:", error);
    return res.status(500).json({ error: error.message || "Failed to generate AI response" });
  }
}
