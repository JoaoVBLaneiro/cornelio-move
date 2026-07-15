const fs = require("fs");

const p = "patch-native-fcm-service.py";
let s = fs.readFileSync(p, "utf8");

// Troca ID aleatorio por ID fixo baseado na chamada.
// Assim a mesma corrida sempre usa a mesma notificacao.
s = s.replace(
  'val notificationId = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()',
  `val notificationId = try {
      kotlin.math.abs(("corrida-" + (data["idChamada"] ?: "")).hashCode())
    } catch (_: Exception) {
      991199
    }`
);

// Faz cancelarNotificacao limpar tudo do app, nao so o ID individual.
s = s.replace(
`  private fun cancelarNotificacao() {{
    try {{
      val notificationId = intent.getIntExtra("notificationId", 0)
      if (notificationId != 0) {{
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(notificationId)
      }}
    }} catch (_: Exception) {{}}
  }}`,
`  private fun cancelarNotificacao() {{
    try {{
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

      val notificationId = intent.getIntExtra("notificationId", 0)
      if (notificationId != 0) {{
        manager.cancel(notificationId)
      }}

      // Limpeza defensiva: remove qualquer vestigio de notificacao/fullscreen antigo.
      manager.cancelAll()
    }} catch (_: Exception) {{}}
  }}`
);

// Depois de cancelar/finalizar, limpa intent e fecha de vez.
s = s.replace(
`              if (acao == "cancelar" || acao == "finalizar") {{
                abrirAppPrincipal()
              }}

              finish()`,
`              if (acao == "cancelar" || acao == "finalizar") {{
                abrirAppPrincipal()
              }}

              intent.replaceExtras(android.os.Bundle())
              finishAndRemoveTask()`
);

// Depois de chamada indisponivel, também limpa tudo.
s = s.replace(
`            Toast.makeText(this, "Chamada indisponivel", Toast.LENGTH_LONG).show()
            finish()`,
`            cancelarNotificacao()
            Toast.makeText(this, "Chamada indisponivel", Toast.LENGTH_LONG).show()
            intent.replaceExtras(android.os.Bundle())
            finishAndRemoveTask()`
);

// Sobe canal para nao herdar comportamento antigo do Android.
s = s.replaceAll("corridas_urgentes_v9", "corridas_urgentes_v10");
s = s.replaceAll("corridas_urgentes_v8", "corridas_urgentes_v10");

fs.writeFileSync(p, s, "utf8");
console.log("Patch aplicado: notificacao fixa por corrida e limpeza total ao finalizar/cancelar.");
