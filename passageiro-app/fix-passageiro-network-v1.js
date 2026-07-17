const fs = require("fs");

const app = "App.js";
let s = fs.readFileSync(app, "utf8");

s = s.replace(
  "const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;",
  'const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "http://207.180.245.177:3001").replace(/\\/$/, "");'
);

fs.writeFileSync(app, s, "utf8");

const appjson = "app.json";
const j = JSON.parse(fs.readFileSync(appjson, "utf8"));

j.expo.name = "Cornelio Move Passageiro";
j.expo.slug = "cornelio-move-passageiro";
j.expo.scheme = "corneliomovepassageiro";

j.expo.android = {
  ...(j.expo.android || {}),
  package: "com.corneliomove.passageiro",
  usesCleartextTraffic: true,
};

j.expo.plugins = j.expo.plugins || [];

const temBuildProperties = j.expo.plugins.some((plugin) => {
  if (typeof plugin === "string") return plugin === "expo-build-properties";
  return Array.isArray(plugin) && plugin[0] === "expo-build-properties";
});

if (!temBuildProperties) {
  j.expo.plugins.push([
    "expo-build-properties",
    {
      android: {
        usesCleartextTraffic: true
      }
    }
  ]);
}

fs.writeFileSync(appjson, JSON.stringify(j, null, 2));

console.log("OK: passageiro com BACKEND_URL fallback, package correto e HTTP liberado.");