// Known app aliases → Windows commands/paths
const APPS = [
  { name: "WhatsApp",      alias: ["whatsapp", "wa"],                          cmd: "start whatsapp:" },
  { name: "Spotify",       alias: ["spotify", "music"],                        cmd: "start spotify:" },
  { name: "Chrome",        alias: ["chrome", "browser", "web", "google chrome"], cmd: "start chrome" },
  { name: "VS Code",       alias: ["vscode", "code", "editor", "visual studio code"], cmd: "code" },
  { name: "Terminal",      alias: ["terminal", "shell", "term", "cmd", "powershell", "command prompt"], cmd: "start cmd" },
  { name: "Slack",         alias: ["slack"],                                   cmd: "start slack:" },
  { name: "File Explorer", alias: ["files", "finder", "explorer", "file manager", "my computer"], cmd: "explorer" },
  { name: "Notepad",       alias: ["notepad", "text editor", "notes"],         cmd: "notepad" },
  { name: "Calculator",    alias: ["calculator", "calc"],                      cmd: "calc" },
  { name: "Settings",      alias: ["settings", "control panel"],               cmd: "start ms-settings:" },
  { name: "Task Manager",  alias: ["task manager", "taskmgr"],                 cmd: "taskmgr" },
  { name: "Microsoft Edge",alias: ["edge", "microsoft edge"],                  cmd: "start msedge" },
  { name: "YouTube",       alias: ["youtube", "yt"],                           cmd: "start https://youtube.com" },
  { name: "Gmail",         alias: ["gmail", "email", "mail"],                  cmd: "start https://mail.google.com" },
  { name: "Instagram",     alias: ["instagram", "insta", "ig"],                cmd: "start https://instagram.com" },
  { name: "Twitter",       alias: ["twitter", "x"],                            cmd: "start https://x.com" },
  { name: "Discord",       alias: ["discord"],                                 cmd: "start discord:" },
  { name: "Telegram",      alias: ["telegram"],                                cmd: "start tg:" },
  { name: "Paint",         alias: ["paint", "drawing"],                        cmd: "mspaint" },
  { name: "Word",          alias: ["word", "microsoft word", "ms word"],       cmd: "start winword" },
  { name: "Excel",         alias: ["excel", "microsoft excel", "spreadsheet"], cmd: "start excel" },
  { name: "PowerPoint",    alias: ["powerpoint", "ppt", "presentation"],       cmd: "start powerpnt" },
];

function findApp(query) {
  const q = query.toLowerCase().trim()
    .replace(/^the\s+/, "")      // "the WhatsApp" → "WhatsApp"
    .replace(/\s+app$/i, "");    // "WhatsApp app" → "WhatsApp"
  
  return APPS.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.alias.some(al => al.includes(q) || q.includes(al))
  );
}

module.exports = { APPS, findApp };
