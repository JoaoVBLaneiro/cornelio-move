const fs = require("fs");

const p = "patch-native-fcm-service.py";
let s = fs.readFileSync(p, "utf8");

s = s.replace(
`class CornelioIncomingCallActivity : Activity() {{

  private val backendUrl = "http://207.180.245.177:3001"
`,
`class CornelioIncomingCallActivity : Activity() {{

  private val backendUrl = "http://207.180.245.177:3001"
  private val monitorHandler = Handler(Looper.getMainLooper())
  @Volatile
  private var monitorandoTentativa = false
`
);

s = s.replace(
`    habilitarTelaBloqueada()
    montarTela()

  }}`,
`    habilitarTelaBloqueada()
    montarTela()
    iniciarMonitoramentoTentativa()

  }}

  override fun onDestroy() {{
    pararMonitoramentoTentativa()
    super.onDestroy()
  }}`
);

const blocoMonitoramento = `
  private fun iniciarMonitoramentoTentativa() {{
    monitorandoTentativa = true
    checarStatusTentativa()
  }}

  private fun pararMonitoramentoTentativa() {{
    monitorandoTentativa = false
    monitorHandler.removeCallbacksAndMessages(null)
  }}

  private fun checarStatusTentativa() {{
    if (!monitorandoTentativa || isFinishing) {{
      return
    }}

    Thread {{
      try {{
        val urlTexto =
          backendUrl +
            "/motorista/nativo/status?idChamada=" + URLEncoder.encode(extra("idChamada"), "UTF-8") +
            "&tokenTentativa=" + URLEncoder.encode(extra("tokenTentativa"), "UTF-8") +
            "&idMotorista=" + URLEncoder.encode(extra("idMotorista"), "UTF-8")

        val conn = URL(urlTexto).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 5000
        conn.readTimeout = 5000

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val respostaTexto = stream?.bufferedReader(Charsets.UTF_8)?.use {{ it.readText() }} ?: ""

        val json = try {{
          JSONObject(respostaTexto)
        }} catch (_: Exception) {{
          JSONObject()
        }}

        val ok = json.optBoolean("ok", false)
        val ativa = json.optBoolean("ativa", true)

        if (ok && !ativa) {{
          runOnUiThread {{
            encerrarChamadaExpirada()
          }}
          return@Thread
        }}
      }} catch (_: Exception) {{
        // Se a internet falhar por alguns segundos, nao fecha a chamada.
      }}

      runOnUiThread {{
        if (monitorandoTentativa && !isFinishing) {{
          monitorHandler.postDelayed({{ checarStatusTentativa() }}, 1200)
        }}
      }}
    }}.start()
  }}

  private fun encerrarChamadaExpirada() {{
    if (!monitorandoTentativa || isFinishing) {{
      return
    }}

    monitorandoTentativa = false
    cancelarNotificacao()
    Toast.makeText(
      this,
      "Chamada expirada. Enviada para outro motorista.",
      Toast.LENGTH_LONG
    ).show()
    intent.replaceExtras(android.os.Bundle())
    finishAndRemoveTask()
  }}

`;

if (!s.includes("private fun iniciarMonitoramentoTentativa()")) {
  s = s.replace(
    "  private fun montarTela() {{",
    blocoMonitoramento + "  private fun montarTela() {{",
    1
  );
}

s = s.replace(
`  private fun enviarAcao(acao: String) {{
    Thread {{`,
`  private fun enviarAcao(acao: String) {{
    pararMonitoramentoTentativa()

    Thread {{`
);

s = s.replaceAll("corridas_urgentes_v10", "corridas_urgentes_v11");

fs.writeFileSync(p, s, "utf8");

console.log("Patch aplicado: tela nativa monitora se a tentativa ainda pertence ao motorista.");