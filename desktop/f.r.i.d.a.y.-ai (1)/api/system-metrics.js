export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  return res.status(200).json({
    cpu: Math.floor(12 + Math.random() * 15),
    memory: Math.floor(40 + Math.random() * 8),
    status: "ONLINE",
    deployment: "Vercel Cloud Serverless"
  });
}
