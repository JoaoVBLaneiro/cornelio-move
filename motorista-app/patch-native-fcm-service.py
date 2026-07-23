from pathlib import Path
import re

java_root = Path("android/app/src/main/java")
main_files = list(java_root.rglob("MainActivity.kt"))

if not main_files:
    raise SystemExit("MainActivity.kt nao encontrado")

main = main_files[0]
main_text = main.read_text(encoding="utf-8")

package_line = next((line for line in main_text.splitlines() if line.startswith("package ")), None)
if not package_line:
    raise SystemExit("Package nao encontrado no MainActivity.kt")

package_name = package_line.replace("package ", "").strip()

gradle_file = Path("android/app/build.gradle")
gradle_text = gradle_file.read_text(encoding="utf-8")

if "com.google.firebase:firebase-messaging" not in gradle_text:
    gradle_text = gradle_text.replace(
        "dependencies {",
        '''dependencies {
    implementation platform("com.google.firebase:firebase-bom:34.15.0")
    implementation "com.google.firebase:firebase-messaging"
''',
        1,
    )
    gradle_file.write_text(gradle_text, encoding="utf-8")

activity_file = main.parent / "CornelioIncomingCallActivity.kt"

activity_code = f'''package {package_name}

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object CornelioCorridaNativaStore {{
  const val ACTION_CORRIDA_CANCELADA = "com.corneliomove.motorista.ACTION_CORRIDA_CANCELADA"
  private const val PREFS = "cornelio_corrida_nativa_v2"
  private const val ATIVA = "ativa"
  private const val NOTIFICATION_ID = "notificationId"

  private val campos = listOf(
    "tipo",
    "idMotorista",
    "nomeMotorista",
    "idChamada",
    "tokenTentativa",
    "cliente",
    "endereco",
    "observacao",
    "latitudePassageiro",
    "longitudePassageiro",
    "distancia",
    "tempo",
    "origem",
    "notificacaoId"
  )

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun salvar(context: Context, dados: Map<String, String>, notificationId: Int) {{
    val editor = prefs(context).edit().clear()
    editor.putBoolean(ATIVA, true)
    editor.putInt(NOTIFICATION_ID, notificationId)

    for (campo in campos) {{
      editor.putString(campo, dados[campo] ?: "")
    }}

    editor.apply()
  }}

  fun salvarIntent(context: Context, intent: Intent) {{
    val editor = prefs(context).edit()
    editor.putBoolean(ATIVA, true)

    val notificationId = intent.getIntExtra(NOTIFICATION_ID, 0)
    if (notificationId != 0) {{
      editor.putInt(NOTIFICATION_ID, notificationId)
    }}

    for (campo in campos) {{
      val valor = intent.getStringExtra(campo)
      if (!valor.isNullOrBlank()) {{
        editor.putString(campo, valor)
      }}
    }}

    editor.apply()
  }}

  fun valor(context: Context, campo: String): String {{
    return prefs(context).getString(campo, "") ?: ""
  }}

  fun notificationId(context: Context): Int {{
    return prefs(context).getInt(NOTIFICATION_ID, 0)
  }}

  fun limpar(context: Context) {{
    prefs(context).edit().clear().apply()
  }}

  fun criarIntent(context: Context): Intent? {{
    val p = prefs(context)
    if (!p.getBoolean(ATIVA, false)) {{
      return null
    }}

    val idChamada = p.getString("idChamada", "") ?: ""
    val tokenTentativa = p.getString("tokenTentativa", "") ?: ""
    val idMotorista = p.getString("idMotorista", "") ?: ""

    if (idChamada.isBlank() || tokenTentativa.isBlank() || idMotorista.isBlank()) {{
      limpar(context)
      return null
    }}

    val intent = Intent(context, CornelioIncomingCallActivity::class.java)
    intent.addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP
    )

    for (campo in campos) {{
      intent.putExtra(campo, p.getString(campo, "") ?: "")
    }}

    intent.putExtra(NOTIFICATION_ID, p.getInt(NOTIFICATION_ID, 0))
    return intent
  }}
}}

class CornelioIncomingCallActivity : Activity() {{

  private var cancelamentoReceiverRegistrado = false
  private var dialogoCancelamentoAberto = false

  private val cancelamentoReceiver = object : BroadcastReceiver() {{
    override fun onReceive(context: Context?, receivedIntent: Intent?) {{
      if (receivedIntent?.action != CornelioCorridaNativaStore.ACTION_CORRIDA_CANCELADA) {{
        return
      }}

      val idCancelado = receivedIntent.getStringExtra("idChamada") ?: ""
      val idAtual = extra("idChamada")

      if (idCancelado.isNotBlank() && idAtual.isNotBlank() && idCancelado != idAtual) {{
        return
      }}

      val mensagem = receivedIntent.getStringExtra("mensagem")
        ?: "O cliente cancelou a corrida."

      mostrarCancelamentoRecebido(mensagem)
    }}
  }}

  private val backendUrl = "http://207.180.245.177:3001"

  private fun dp(valor: Int): Int =
    (valor * resources.displayMetrics.density).toInt()
  private val monitorHandler = Handler(Looper.getMainLooper())

  @Volatile
  private var monitorandoTentativa = false

  @Volatile
  private var consultaEmAndamento = false

  private var estadoTela = "carregando"

  override fun onCreate(savedInstanceState: Bundle?) {{
    super.onCreate(savedInstanceState)

    habilitarTelaBloqueada()
    CornelioCorridaNativaStore.salvarIntent(this, intent)
    montarTelaCarregando()
    iniciarMonitoramentoTentativa()
  }}

  override fun onStart() {{
    super.onStart()

    if (!cancelamentoReceiverRegistrado) {{
      val filtro = IntentFilter(CornelioCorridaNativaStore.ACTION_CORRIDA_CANCELADA)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {{
        registerReceiver(cancelamentoReceiver, filtro, Context.RECEIVER_NOT_EXPORTED)
      }} else {{
        @Suppress("DEPRECATION")
        registerReceiver(cancelamentoReceiver, filtro)
      }}

      cancelamentoReceiverRegistrado = true
    }}
  }}

  override fun onStop() {{
    if (cancelamentoReceiverRegistrado) {{
      try {{
        unregisterReceiver(cancelamentoReceiver)
      }} catch (_: Exception) {{}}

      cancelamentoReceiverRegistrado = false
    }}

    super.onStop()
  }}

  override fun onNewIntent(novoIntent: Intent?) {{
    super.onNewIntent(novoIntent)

    if (novoIntent != null) {{
      setIntent(novoIntent)
      CornelioCorridaNativaStore.salvarIntent(this, novoIntent)
      estadoTela = "carregando"
      montarTelaCarregando()
      iniciarMonitoramentoTentativa()
    }}
  }}

  override fun onResume() {{
    super.onResume()
    habilitarTelaBloqueada()

    if (!monitorandoTentativa) {{
      iniciarMonitoramentoTentativa()
    }} else {{
      checarStatusTentativa()
    }}
  }}

  override fun onDestroy() {{
    pararMonitoramentoTentativa()
    super.onDestroy()
  }}

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {{
    moveTaskToBack(true)
  }}

  private fun habilitarTelaBloqueada() {{
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {{
      setShowWhenLocked(true)
      setTurnScreenOn(true)

      try {{
        val keyguardManager = getSystemService(KeyguardManager::class.java)
        keyguardManager?.requestDismissKeyguard(this, null)
      }} catch (_: Exception) {{}}
    }} else {{
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      )
    }}
  }}

  private fun extra(nome: String): String {{
    val direto = intent.getStringExtra(nome) ?: ""
    if (direto.isNotBlank()) {{
      return direto
    }}

    return CornelioCorridaNativaStore.valor(this, nome)
  }}

  private fun notificationIdAtual(): Int {{
    val direto = intent.getIntExtra("notificationId", 0)
    return if (direto != 0) direto else CornelioCorridaNativaStore.notificationId(this)
  }}

  private fun iniciarMonitoramentoTentativa() {{
    monitorandoTentativa = true
    monitorHandler.removeCallbacksAndMessages(null)
    checarStatusTentativa()
  }}

  private fun pararMonitoramentoTentativa() {{
    monitorandoTentativa = false
    monitorHandler.removeCallbacksAndMessages(null)
  }}

  private fun agendarNovaConsulta() {{
    if (monitorandoTentativa && !isFinishing) {{
      monitorHandler.postDelayed({{ checarStatusTentativa() }}, 1200)
    }}
  }}

  private fun checarStatusTentativa() {{
    if (!monitorandoTentativa || isFinishing || consultaEmAndamento) {{
      return
    }}

    val idChamada = extra("idChamada")
    val tokenTentativa = extra("tokenTentativa")
    val idMotorista = extra("idMotorista")

    if (idChamada.isBlank() || tokenTentativa.isBlank() || idMotorista.isBlank()) {{
      encerrarChamadaExpirada("Dados da corrida incompletos.")
      return
    }}

    consultaEmAndamento = true

    Thread {{
      var respostaValida = false
      var ativa = true
      var estado = ""

      try {{
        val urlTexto =
          backendUrl +
            "/motorista/nativo/status?idChamada=" + URLEncoder.encode(idChamada, "UTF-8") +
            "&tokenTentativa=" + URLEncoder.encode(tokenTentativa, "UTF-8") +
            "&idMotorista=" + URLEncoder.encode(idMotorista, "UTF-8")

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

        respostaValida = json.optBoolean("ok", false)
        ativa = json.optBoolean("ativa", true)
        estado = json.optString("estado", "")
      }} catch (_: Exception) {{
        // Uma falha temporaria de rede nao encerra nem troca a tela da corrida.
      }}

      runOnUiThread {{
        consultaEmAndamento = false

        if (!monitorandoTentativa || isFinishing) {{
          return@runOnUiThread
        }}

        if (respostaValida && !ativa) {{
          val mensagem = if (estadoTela == "aceita") {{
            "Corrida encerrada."
          }} else {{
            "Chamada expirada ou enviada para outro motorista."
          }}
          encerrarChamadaExpirada(mensagem)
          return@runOnUiThread
        }}

        if (respostaValida && ativa) {{
          when (estado) {{
            "aceita" -> mostrarTelaCorridaAceitaSeNecessario()
            "tentando_motorista" -> mostrarTelaChamadaSeNecessario()
          }}
        }}

        agendarNovaConsulta()
      }}
    }}.start()
  }}

  private fun mostrarCancelamentoRecebido(mensagem: String) {{
    if (isFinishing || dialogoCancelamentoAberto) {{
      return
    }}

    dialogoCancelamentoAberto = true
    pararMonitoramentoTentativa()
    CornelioCorridaNativaStore.limpar(this)
    cancelarNotificacao()

    AlertDialog.Builder(this)
      .setTitle("Corrida cancelada")
      .setMessage(mensagem)
      .setCancelable(false)
      .setPositiveButton("OK") {{ _, _ ->
        dialogoCancelamentoAberto = false
        abrirAppPrincipal()
        intent.replaceExtras(Bundle())
        finish()
      }}
      .show()
  }}

  private fun encerrarChamadaExpirada(mensagem: String) {{
    if (isFinishing) {{
      return
    }}

    pararMonitoramentoTentativa()
    CornelioCorridaNativaStore.limpar(this)
    cancelarNotificacao()
    Toast.makeText(this, mensagem, Toast.LENGTH_LONG).show()
    intent.replaceExtras(Bundle())
    finish()
  }}

  private fun montarTelaCarregando() {{
    estadoTela = "carregando"

    val root = LinearLayout(this)
    root.orientation = LinearLayout.VERTICAL
    root.gravity = Gravity.CENTER
    root.setPadding(dp(16), dp(24), dp(16), dp(24))
    root.setBackgroundColor(Color.rgb(11, 18, 32))

    val titulo = TextView(this)
    titulo.text = "Verificando corrida..."
    titulo.textSize = 27f
    titulo.setTextColor(Color.WHITE)
    titulo.gravity = Gravity.CENTER
    root.addView(titulo)

    setContentView(root)
  }}

  private fun mostrarTelaChamadaSeNecessario() {{
    if (estadoTela != "tentando_motorista") {{
      montarTelaChamada()
    }}
  }}

  private fun mostrarTelaCorridaAceitaSeNecessario() {{
    if (estadoTela != "aceita") {{
      montarTelaCorridaAceita()
    }}
  }}

  private fun montarTelaChamada() {{
    estadoTela = "tentando_motorista"

    val cliente = extra("cliente").ifBlank {{ "Cliente" }}
    val endereco = extra("endereco").ifBlank {{ "Endereco nao informado" }}
    val distancia = extra("distancia")
    val tempo = extra("tempo")
    val observacao = extra("observacao")

    val scroll = ScrollView(this)
    val root = LinearLayout(this)
    root.orientation = LinearLayout.VERTICAL
    root.setPadding(dp(16), dp(24), dp(16), dp(24))
    root.setBackgroundColor(Color.rgb(11, 18, 32))
    scroll.addView(root)

    val titulo = TextView(this)
    titulo.text = "Nova chamada"
    titulo.textSize = 34f
    titulo.setTextColor(Color.WHITE)
    titulo.gravity = Gravity.CENTER
    titulo.setTypeface(null, 1)
    root.addView(titulo)

    val card = LinearLayout(this)
    card.orientation = LinearLayout.VERTICAL
    card.setPadding(dp(18), dp(18), dp(18), dp(18))
    card.setBackgroundColor(Color.rgb(255, 204, 20))

    val cardParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    cardParams.setMargins(0, dp(18), 0, dp(18))
    root.addView(card, cardParams)

    fun textoCard(valor: String, tamanho: Float, negrito: Boolean = false): TextView {{
      val t = TextView(this)
      t.text = valor
      t.textSize = tamanho
      t.setTextColor(Color.rgb(15, 23, 42))
      if (negrito) t.setTypeface(null, 1)
      t.setPadding(0, 8, 0, 8)
      return t
    }}

    card.addView(textoCard("Cliente: " + cliente, 22f, true))
    card.addView(textoCard("Endereco: " + endereco, 22f, true))

    if (distancia.isNotBlank() || tempo.isNotBlank()) {{
      card.addView(textoCard("Distancia: " + distancia + "   Tempo: " + tempo, 18f, false))
    }}

    if (observacao.isNotBlank()) {{
      card.addView(textoCard("Obs: " + observacao, 18f, false))
    }}

    val botoes = LinearLayout(this)
    botoes.orientation = LinearLayout.HORIZONTAL
    botoes.gravity = Gravity.CENTER

    val recusar = Button(this)
    recusar.text = "Recusar"
    recusar.textSize = 22f
    recusar.setTextColor(Color.WHITE)
    recusar.setBackgroundColor(Color.rgb(220, 38, 38))

    val aceitar = Button(this)
    aceitar.text = "Aceitar"
    aceitar.textSize = 22f
    aceitar.setTextColor(Color.WHITE)
    aceitar.setBackgroundColor(Color.rgb(22, 163, 74))

    recusar.gravity = Gravity.CENTER
    aceitar.gravity = Gravity.CENTER
    recusar.minimumHeight = dp(64)
    aceitar.minimumHeight = dp(64)
    recusar.setPadding(dp(10), 0, dp(10), 0)
    aceitar.setPadding(dp(10), 0, dp(10), 0)

    val p1 = LinearLayout.LayoutParams(0, dp(64), 1f)
    p1.setMargins(0, dp(12), dp(6), 0)

    val p2 = LinearLayout.LayoutParams(0, dp(64), 1f)
    p2.setMargins(dp(6), dp(12), 0, 0)

    botoes.addView(recusar, p1)
    botoes.addView(aceitar, p2)
    card.addView(botoes)

    recusar.setOnClickListener {{
      recusar.isEnabled = false
      aceitar.isEnabled = false
      enviarAcao("recusar")
    }}

    aceitar.setOnClickListener {{
      recusar.isEnabled = false
      aceitar.isEnabled = false
      enviarAcao("aceitar")
    }}

    setContentView(scroll)
  }}

  private fun montarTelaCorridaAceita() {{
    estadoTela = "aceita"
    CornelioCorridaNativaStore.salvarIntent(this, intent)

    val endereco = extra("endereco").ifBlank {{ "Endereco nao informado" }}
    val cliente = extra("cliente").ifBlank {{ "Cliente" }}
    val distancia = extra("distancia")
    val tempo = extra("tempo")
    val observacao = extra("observacao")

    val scroll = ScrollView(this)
    val root = LinearLayout(this)
    root.orientation = LinearLayout.VERTICAL
    root.setPadding(dp(16), dp(24), dp(16), dp(24))
    root.setBackgroundColor(Color.rgb(11, 18, 32))
    scroll.addView(root)

    fun texto(valor: String, tamanho: Float, cor: Int = Color.WHITE, negrito: Boolean = false): TextView {{
      val t = TextView(this)
      t.text = valor
      t.textSize = tamanho
      t.setTextColor(cor)
      if (negrito) t.setTypeface(null, 1)
      t.setPadding(0, 8, 0, 8)
      return t
    }}

    val titulo = texto("Corrida aceita", 34f, Color.WHITE, true)
    titulo.gravity = Gravity.CENTER
    root.addView(titulo)

    val card = LinearLayout(this)
    card.orientation = LinearLayout.VERTICAL
    card.setPadding(dp(18), dp(18), dp(18), dp(18))
    card.setBackgroundColor(Color.rgb(31, 41, 55))

    val cardParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    cardParams.setMargins(0, dp(18), 0, dp(18))
    root.addView(card, cardParams)

    card.addView(texto("Cliente: " + cliente, 20f, Color.WHITE, true))
    card.addView(texto("Endereco:", 18f, Color.WHITE, false))
    card.addView(texto(endereco, 24f, Color.WHITE, true))

    if (distancia.isNotBlank() || tempo.isNotBlank()) {{
      card.addView(texto("Distancia: " + distancia + "   Tempo: " + tempo, 18f, Color.WHITE, false))
    }}

    if (observacao.isNotBlank()) {{
      card.addView(texto("Obs: " + observacao, 18f, Color.WHITE, false))
    }}

    fun botao(rotulo: String, cor: Int): Button {{
      val b = Button(this)
      b.text = rotulo
      b.textSize = 20f
      b.setTextColor(Color.WHITE)
      b.setBackgroundColor(cor)
      b.gravity = Gravity.CENTER
      b.minimumHeight = dp(64)
      b.setPadding(dp(12), 0, dp(12), 0)
      return b
    }}

    val navegar = botao("Abrir navegacao", Color.rgb(37, 99, 235))
    val cancelar = botao("Cancelar corrida", Color.rgb(220, 38, 38))
    val finalizar = botao("Finalizar corrida", Color.rgb(22, 163, 74))

    val params = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      dp(64)
    )
    params.setMargins(0, dp(12), 0, 0)

    card.addView(navegar, params)
    card.addView(cancelar, params)
    card.addView(finalizar, params)

    navegar.setOnClickListener {{
      abrirNavegacao()
    }}

    cancelar.setOnClickListener {{
      cancelar.isEnabled = false
      finalizar.isEnabled = false
      enviarAcao("cancelar")
    }}

    finalizar.setOnClickListener {{
      cancelar.isEnabled = false
      finalizar.isEnabled = false
      enviarAcao("finalizar")
    }}

    setContentView(scroll)
  }}

  private fun abrirNavegacao() {{
    try {{
      val lat = extra("latitudePassageiro")
      val lon = extra("longitudePassageiro")
      val endereco = extra("endereco")

      val url = if (lat.isNotBlank() && lon.isNotBlank()) {{
        "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lon + "&travelmode=driving"
      }} else {{
        "https://www.google.com/maps/search/?api=1&query=" + URLEncoder.encode(endereco, "UTF-8")
      }}

      val mapaIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      mapaIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(mapaIntent)
    }} catch (e: Exception) {{
      Toast.makeText(this, "Erro ao abrir navegacao: " + e.message, Toast.LENGTH_LONG).show()
    }}
  }}

  private fun enviarAcao(acao: String) {{
    pararMonitoramentoTentativa()

    Thread {{
      try {{
        val url = URL(backendUrl + "/motorista/nativo/" + acao)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.connectTimeout = 7000
        conn.readTimeout = 7000
        conn.doOutput = true

        val body = JSONObject()
        body.put("idChamada", extra("idChamada"))
        body.put("tokenTentativa", extra("tokenTentativa"))
        body.put("idMotorista", extra("idMotorista"))
        body.put("nomeMotorista", extra("nomeMotorista"))
        body.put("endereco", extra("endereco"))

        OutputStreamWriter(conn.outputStream, "UTF-8").use {{
          it.write(body.toString())
        }}

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val respostaTexto = stream?.bufferedReader(Charsets.UTF_8)?.use {{ it.readText() }} ?: ""
        val ok = try {{
          JSONObject(respostaTexto).optBoolean("ok", false)
        }} catch (_: Exception) {{
          false
        }}

        runOnUiThread {{
          cancelarNotificacao()

          if (ok) {{
            if (acao == "aceitar") {{
              Toast.makeText(this, "Chamada aceita", Toast.LENGTH_LONG).show()
              CornelioCorridaNativaStore.salvarIntent(this, intent)
              montarTelaCorridaAceita()
              iniciarMonitoramentoTentativa()
            }} else {{
              val mensagem = when (acao) {{
                "recusar" -> "Chamada recusada"
                "cancelar" -> "Corrida cancelada"
                "finalizar" -> "Corrida finalizada"
                else -> "Acao concluida"
              }}

              Toast.makeText(this, mensagem, Toast.LENGTH_LONG).show()
              CornelioCorridaNativaStore.limpar(this)

              if (acao == "cancelar" || acao == "finalizar") {{
                abrirAppPrincipal()
              }}

              intent.replaceExtras(Bundle())
              finish()
            }}
          }} else {{
            // O backend e a fonte oficial: consulta o estado antes de fechar a tela.
            Toast.makeText(this, "Atualizando estado da corrida...", Toast.LENGTH_SHORT).show()
            iniciarMonitoramentoTentativa()
          }}
        }}
      }} catch (e: Exception) {{
        runOnUiThread {{
          Toast.makeText(this, "Falha de conexao. Verificando corrida...", Toast.LENGTH_LONG).show()
          iniciarMonitoramentoTentativa()
        }}
      }}
    }}.start()
  }}

  private fun cancelarNotificacao() {{
    try {{
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val notificationId = notificationIdAtual()

      if (notificationId != 0) {{
        manager.cancel(notificationId)
      }}
    }} catch (_: Exception) {{}}
  }}

  private fun abrirAppPrincipal() {{
    try {{
      val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
      launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      if (launchIntent != null) {{
        startActivity(launchIntent)
      }}
    }} catch (_: Exception) {{}}
  }}
}}
'''

activity_file.write_text(activity_code, encoding="utf-8")
print("CornelioIncomingCallActivity nativa exclusiva criada")

service_file = main.parent / "CornelioFirebaseMessagingService.kt"

service_code = f'''package {package_name}

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.Process
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class CornelioFirebaseMessagingService : FirebaseMessagingService() {{

  override fun onMessageReceived(remoteMessage: RemoteMessage) {{
    super.onMessageReceived(remoteMessage)

    val data = remoteMessage.data

    when (data["tipo"]) {{
      "nova_corrida_motorista" -> tratarNovaCorrida(data)
      "corrida_cancelada_motorista" -> tratarCorridaCancelada(data, remoteMessage)
    }}
  }}

  private fun tratarNovaCorrida(data: Map<String, String>) {{
    val notificationId = try {{
      kotlin.math.abs(("corrida-" + (data["idChamada"] ?: "")).hashCode())
    }} catch (_: Exception) {{
      991199
    }}

    CornelioCorridaNativaStore.salvar(this, data, notificationId)
    acordarTela()

    if (aplicativoEmPrimeiroPlano()) {{
      abrirTelaNativa(notificationId)
    }} else {{
      mostrarNotificacaoCorrida(data, notificationId)
    }}
  }}

  private fun tratarCorridaCancelada(
    data: Map<String, String>,
    remoteMessage: RemoteMessage
  ) {{
    val idChamada = data["idChamada"] ?: ""
    val idSalvo = CornelioCorridaNativaStore.valor(this, "idChamada")
    val mensagem = data["mensagem"]
      ?: remoteMessage.notification?.body
      ?: "O cliente cancelou a corrida."

    if (idChamada.isBlank() || idSalvo.isBlank() || idChamada == idSalvo) {{
      try {{
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notificationIdCorrida = CornelioCorridaNativaStore.notificationId(this)
        if (notificationIdCorrida != 0) {{
          manager.cancel(notificationIdCorrida)
        }}
      }} catch (_: Exception) {{}}

      CornelioCorridaNativaStore.limpar(this)
    }}

    val broadcast = Intent(CornelioCorridaNativaStore.ACTION_CORRIDA_CANCELADA)
      .setPackage(packageName)
      .putExtra("idChamada", idChamada)
      .putExtra("mensagem", mensagem)

    sendBroadcast(broadcast)
    mostrarNotificacaoCancelamento(idChamada, mensagem)
  }}

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

  private fun abrirTelaNativa(notificationId: Int) {{
    val callIntent = CornelioCorridaNativaStore.criarIntent(this) ?: return
    callIntent.putExtra("notificationId", notificationId)
    startActivity(callIntent)
  }}

  private fun acordarTela() {{
    try {{
      val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
      val wakeLock = powerManager.newWakeLock(
        PowerManager.FULL_WAKE_LOCK or
          PowerManager.ACQUIRE_CAUSES_WAKEUP or
          PowerManager.ON_AFTER_RELEASE,
        "CornelioMove:CorridaWakeLock"
      )
      wakeLock.acquire(10000)
    }} catch (_: Exception) {{}}
  }}

  private fun mostrarNotificacaoCorrida(data: Map<String, String>, notificationId: Int) {{
    val channelId = "corridas_urgentes_native_only_v2"
    criarCanalCorridas(channelId)

    val callIntent = CornelioCorridaNativaStore.criarIntent(this) ?: return
    callIntent.putExtra("notificationId", notificationId)

    val flags =
      PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    val fullScreenPendingIntent = PendingIntent.getActivity(
      this,
      notificationId,
      callIntent,
      flags
    )

    val endereco = data["endereco"] ?: "Toque para atender"
    val cliente = data["cliente"] ?: "Cliente"

    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Nova corrida")
      .setContentText(endereco)
      .setStyle(NotificationCompat.BigTextStyle().bigText(cliente + "\\n" + endereco))
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setTimeoutAfter(45000)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setVibrate(longArrayOf(0, 700, 300, 700, 300, 700))
      .setContentIntent(fullScreenPendingIntent)
      .setFullScreenIntent(fullScreenPendingIntent, true)
      .build()

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(notificationId, notification)
  }}

  private fun mostrarNotificacaoCancelamento(idChamada: String, mensagem: String) {{
    val channelId = "avisos_cancelamento_corrida_v1"
    criarCanalCancelamento(channelId)

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent(this, MainActivity::class.java)
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    val notificationId = try {{
      kotlin.math.abs(("cancelamento-" + idChamada).hashCode())
    }} catch (_: Exception) {{
      992299
    }}

    val flags =
      PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    val pendingIntent = PendingIntent.getActivity(
      this,
      notificationId,
      launchIntent,
      flags
    )

    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Corrida cancelada")
      .setContentText(mensagem)
      .setStyle(NotificationCompat.BigTextStyle().bigText(mensagem))
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setVibrate(longArrayOf(0, 500, 250, 500))
      .setContentIntent(pendingIntent)
      .build()

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(notificationId, notification)
  }}

  private fun criarCanalCancelamento(channelId: String) {{
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {{
      return
    }}

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val canal = NotificationChannel(
      channelId,
      "Avisos de cancelamento",
      NotificationManager.IMPORTANCE_HIGH
    )

    canal.description = "Avisos quando uma corrida e cancelada"
    canal.enableVibration(true)
    canal.vibrationPattern = longArrayOf(0, 500, 250, 500)
    canal.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC

    manager.createNotificationChannel(canal)
  }}

  private fun criarCanalCorridas(channelId: String) {{
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {{
      return
    }}

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    val canal = NotificationChannel(
      channelId,
      "Corridas urgentes",
      NotificationManager.IMPORTANCE_HIGH
    )

    canal.description = "Chamadas de corrida do Cornelio Move"
    canal.enableVibration(true)
    canal.vibrationPattern = longArrayOf(0, 700, 300, 700, 300, 700)
    canal.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC

    manager.createNotificationChannel(canal)
  }}
}}
'''

service_file.write_text(service_code, encoding="utf-8")
print("CornelioFirebaseMessagingService nativo exclusivo atualizado")

# MainActivity: ao tocar no icone/voltar ao app, reabre a Activity nativa salva.
main_text = main.read_text(encoding="utf-8")

if "private var abrindoCorridaNativaSalva" not in main_text:
    class_match = re.search(r"class\s+MainActivity[^{]*\{", main_text)
    if not class_match:
        raise SystemExit("Nao encontrei abertura da classe MainActivity")

    insert_pos = class_match.end()
    main_text = (
        main_text[:insert_pos]
        + "\n  private var abrindoCorridaNativaSalva = false\n"
        + main_text[insert_pos:]
    )

if "abrirCorridaNativaSalvaSeNecessario()" not in main_text:
    old_resume = '''  override fun onResume() {
    super.onResume()
    habilitarTelaCheiaSobreBloqueio()
  }'''
    new_resume = '''  override fun onResume() {
    super.onResume()
    habilitarTelaCheiaSobreBloqueio()
    abrirCorridaNativaSalvaSeNecessario()
  }'''

    if old_resume not in main_text:
        raise SystemExit("Nao encontrei onResume gerado pelo patch de lockscreen")

    main_text = main_text.replace(old_resume, new_resume, 1)

    helper = '''

  private fun abrirCorridaNativaSalvaSeNecessario() {
    if (abrindoCorridaNativaSalva) {
      return
    }

    val corridaIntent = CornelioCorridaNativaStore.criarIntent(this) ?: return
    abrindoCorridaNativaSalva = true
    startActivity(corridaIntent)

    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
      abrindoCorridaNativaSalva = false
    }, 1200)
  }
'''

    ultimo_fecha = main_text.rfind("\n}")
    if ultimo_fecha < 0:
        raise SystemExit("Nao encontrei fechamento da MainActivity")

    main_text = main_text[:ultimo_fecha] + helper + main_text[ultimo_fecha:]

main.write_text(main_text, encoding="utf-8")
print("MainActivity configurada para restaurar somente a tela nativa")

manifest = Path("android/app/src/main/AndroidManifest.xml")
text = manifest.read_text(encoding="utf-8")

activity_decl = '''    <activity
      android:name=".CornelioIncomingCallActivity"
      android:exported="false"
      android:excludeFromRecents="true"
      android:launchMode="singleTask"
      android:showWhenLocked="true"
      android:turnScreenOn="true" />
'''

service_decl = '''    <service
      android:name=".CornelioFirebaseMessagingService"
      android:exported="false">
      <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
      </intent-filter>
    </service>
'''

if "CornelioIncomingCallActivity" not in text:
    text = text.replace("</application>", activity_decl + "\n  </application>")

if "CornelioFirebaseMessagingService" not in text:
    text = text.replace("</application>", service_decl + "\n  </application>")

manifest.write_text(text, encoding="utf-8")
print("Manifest atualizado para fluxo nativo exclusivo")
