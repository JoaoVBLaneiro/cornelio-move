const fs = require("fs");

const p = "App.js";
let s = fs.readFileSync(p, "utf8");

s = s.replace(
  /setStatusPush\("Erro ao configurar notifica[^"]*"\);/g,
  'setStatusPush("Erro push: " + error.message); Alert.alert("Erro push", error.message);'
);

s = s.replace(
  /Login do Mototaxista - V8 PUSH/g,
  "Login do Mototaxista - V8.2 DIAG PUSH"
);

s = s.replace(
  /App do Mototaxista - V8 PUSH/g,
  "App do Mototaxista - V8.2 DIAG PUSH"
);

fs.writeFileSync(p, s, "utf8");

console.log("App.js corrigido para V8.2 DIAG PUSH");
