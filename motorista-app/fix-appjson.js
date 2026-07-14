const fs = require("fs");

const config = {
  expo: {
    name: "Cornelio Move Motorista",
    slug: "motorista-app",
    version: "1.0.83",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    assetBundlePatterns: ["**/*"],
    android: {
      package: "com.corneliomove.motorista",
      versionCode: 83,
      permissions: [
        "android.permission.INTERNET",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.POST_NOTIFICATIONS"
      ],
      googleServicesFile: "./google-services.json"
    },
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: true
          }
        }
      ],
      "expo-notifications"
    ],
    extra: {
      eas: {
        projectId: "fdce80a9-919e-4538-8500-d207f2cd1480"
      }
    }
  }
};

fs.writeFileSync("app.json", JSON.stringify(config, null, 2), "utf8");

JSON.parse(fs.readFileSync("app.json", "utf8"));

console.log("app.json recriado e valido");
console.log(config.expo.android.permissions);
