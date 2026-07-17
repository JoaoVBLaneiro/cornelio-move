const fs = require("fs");

const p = "app.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));

j.expo.name = "Cornelio Move Passageiro";
j.expo.slug = "cornelio-move-passageiro";

j.expo.scheme = "corneliomovepassageiro";

j.expo.android = {
  ...(j.expo.android || {}),
  package: "com.corneliomove.passageiro",
  versionCode: Math.max(Number(j.expo.android?.versionCode || 1), 3),
};

fs.writeFileSync(p, JSON.stringify(j, null, 2));

console.log("Passageiro corrigido para package com.corneliomove.passageiro");