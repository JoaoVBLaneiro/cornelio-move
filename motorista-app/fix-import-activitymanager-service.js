const fs = require("fs");

const p = "patch-native-fcm-service.py";
let s = fs.readFileSync(p, "utf8");

const serviceStart = s.indexOf("service_code = f'''package {package_name}");

if (serviceStart < 0) {
  throw new Error("Nao encontrei service_code.");
}

const serviceEnd = s.indexOf("'''", serviceStart + 30);

if (serviceEnd < 0) {
  throw new Error("Nao encontrei fim do service_code.");
}

let service = s.slice(serviceStart, serviceEnd);

if (!service.includes("import android.app.ActivityManager")) {
  service = service.replace(
    "import android.app.NotificationManager\n",
    "import android.app.NotificationManager\nimport android.app.ActivityManager\n"
  );
}

if (!service.includes("import android.os.Process")) {
  service = service.replace(
    "import android.os.PowerManager\n",
    "import android.os.PowerManager\nimport android.os.Process\n"
  );
}

s = s.slice(0, serviceStart) + service + s.slice(serviceEnd);

fs.writeFileSync(p, s, "utf8");

console.log("Corrigido: ActivityManager e Process importados no CornelioFirebaseMessagingService.");