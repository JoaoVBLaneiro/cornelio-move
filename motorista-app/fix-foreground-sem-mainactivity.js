const fs = require("fs");

const p = "patch-native-fcm-service.py";
let s = fs.readFileSync(p, "utf8");

// Remove a estrategia anterior que mexia no MainActivity e causou onResume duplicado.
const startBlock = s.indexOf('app_state_file = main.parent / "CornelioAppForegroundState.kt"');
if (startBlock >= 0) {
  const endBlock = s.indexOf('gradle_file = Path("android/app/build.gradle")', startBlock);

  if (endBlock < 0) {
    throw new Error("Nao encontrei o fim do bloco CornelioAppForegroundState.");
  }

  s = s.slice(0, startBlock) + s.slice(endBlock);
}

// Remove uso antigo de CornelioAppForegroundState dentro do service.
s = s.replace(
`    if (CornelioAppForegroundState.emPrimeiroPlano) {{
      return
    }}

`,
""
);

// Adiciona imports nativos para consultar estado do processo.
if (!s.includes("import android.app.ActivityManager")) {
  s = s.replace(
    "import android.app.NotificationManager\n",
    "import android.app.NotificationManager\nimport android.app.ActivityManager\n"
  );
}

if (!s.includes("import android.os.Process")) {
  s = s.replace(
    "import android.os.PowerManager\n",
    "import android.os.PowerManager\nimport android.os.Process\n"
  );
}

// Adiciona a checagem antes de criar notificacao.
const chamadaAntiga = `    acordarTela()
    mostrarNotificacaoCorrida(data)`;

const chamadaNova = `    if (aplicativoEmPrimeiroPlano()) {{
      return
    }}

    acordarTela()
    mostrarNotificacaoCorrida(data)`;

if (!s.includes("aplicativoEmPrimeiroPlano()")) {
  if (!s.includes(chamadaAntiga)) {
    throw new Error("Nao encontrei acordarTela()/mostrarNotificacaoCorrida(data).");
  }

  s = s.replace(chamadaAntiga, chamadaNova);
}

// Adiciona funcao que verifica se o app esta em primeiro plano.
const funcaoForeground = `
  private fun aplicativoEmPrimeiroPlano(): Boolean {{
    return try {{
      val manager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val processos = manager.runningAppProcesses ?: return false
      val pid = Process.myPid()

      processos.any {{ processo ->
        processo.pid == pid &&
          (
            processo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
            processo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
          )
      }}
    }} catch (_: Exception) {{
      false
    }}
  }}

`;

if (!s.includes("private fun aplicativoEmPrimeiroPlano(): Boolean")) {
  s = s.replace(
    "  private fun acordarTela() {{",
    funcaoForeground + "  private fun acordarTela() {{",
    1
  );
}

// Sobe canal só para garantir comportamento limpo no Android.
s = s.replaceAll("corridas_urgentes_v11", "corridas_urgentes_v12");
s = s.replaceAll("corridas_urgentes_v10", "corridas_urgentes_v12");

fs.writeFileSync(p, s, "utf8");

console.log("Corrigido: foreground sem mexer no MainActivity.");