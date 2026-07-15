const fs = require("fs");

const p = "patch-native-fcm-service.py";
let s = fs.readFileSync(p, "utf8");

const startText = "val notificationId = try {";
const start = s.indexOf(startText);

if (start < 0) {
  if (s.includes("val notificationId = try {{")) {
    console.log("Ja estava corrigido.");
    process.exit(0);
  }

  throw new Error("Nao encontrei o trecho val notificationId = try {");
}

const pos991199 = s.indexOf("991199", start);
if (pos991199 < 0) {
  throw new Error("Nao encontrei 991199 depois do notificationId.");
}

const endText = "    }";
const end = s.indexOf(endText, pos991199);

if (end < 0) {
  throw new Error("Nao encontrei o fechamento do catch.");
}

const replacement = `val notificationId = try {{
      kotlin.math.abs(("corrida-" + (data["idChamada"] ?: "")).hashCode())
    }} catch (_: Exception) {{
      991199
    }}`;

s = s.slice(0, start) + replacement + s.slice(end + endText.length);

fs.writeFileSync(p, s, "utf8");

console.log("Corrigido: chaves Kotlin escapadas dentro da f-string Python.");