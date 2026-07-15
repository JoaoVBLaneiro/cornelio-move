from pathlib import Path

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
        """dependencies {
    implementation platform("com.google.firebase:firebase-bom:34.15.0")
    implementation "com.google.firebase:firebase-messaging"
""",
        1
    )
    gradle_file.write_text(gradle_text, encoding="utf-8")

activity_file = main.parent / "CornelioIncomingCallActivity.kt"

activity_code = f'''package {package_name}

import android.app.Activity
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.net.Uri
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

class CornelioIncomingCallActivity : Activity() {{

  private val backendUrl = "http://207.180.245.177:3001"

  override fun onCreate(savedInstanceState: Bundle?) {{
    super.onCreate(savedInstanceState)

    habilitarTelaBloqueada()
    montarTela()

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
    return intent.getStringExtra(nome) ?: ""
  }}

  private fun montarTela() {{
    val cliente = extra("cliente").ifBlank {{ "Cliente" }}
    val endereco = extra("endereco").ifBlank {{ "Endereco nao informado" }}
    val distancia = extra("distancia")
    val tempo = extra("tempo")
    val observacao = extra("observacao")

    val scroll = ScrollView(this)
    val root = LinearLayout(this)
    root.orientation = LinearLayout.VERTICAL
    root.setPadding(42, 56, 42, 42)
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
    card.setPadding(34, 34, 34, 34)
    card.setBackgroundColor(Color.rgb(255, 204, 20))

    val cardParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    cardParams.setMargins(0, 36, 0, 36)
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

    val p1 = LinearLayout.LayoutParams(0, 120, 1f)
    p1.setMargins(0, 24, 16, 0)

    val p2 = LinearLayout.LayoutParams(0, 120, 1f)
    p2.setMargins(16, 24, 0, 0)

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
    val endereco = extra("endereco").ifBlank {{ "Endereco nao informado" }}
    val cliente = extra("cliente").ifBlank {{ "Cliente" }}
    val distancia = extra("distancia")
    val tempo = extra("tempo")
    val observacao = extra("observacao")

    val scroll = ScrollView(this)
    val root = LinearLayout(this)
    root.orientation = LinearLayout.VERTICAL
    root.setPadding(42, 56, 42, 42)
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
    card.setPadding(34, 34, 34, 34)
    card.setBackgroundColor(Color.rgb(31, 41, 55))

    val cardParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    cardParams.setMargins(0, 36, 0, 36)
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
      b.textSize = 21f
      b.setTextColor(Color.WHITE)
      b.setBackgroundColor(cor)
      return b
    }}

    val navegar = botao("Abrir navegacao", Color.rgb(37, 99, 235))
    val cancelar = botao("Cancelar corrida", Color.rgb(220, 38, 38))
    val finalizar = botao("Finalizar corrida", Color.rgb(22, 163, 74))

    val params = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      120
    )
    params.setMargins(0, 22, 0, 0)

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

      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
    }} catch (e: Exception) {{
      Toast.makeText(this, "Erro ao abrir navegacao: " + e.message, Toast.LENGTH_LONG).show()
    }}
  }}

  private fun enviarAcao(acao: String) {{
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
              montarTelaCorridaAceita()
            }} else {{
              val mensagem = when (acao) {{
                "recusar" -> "Chamada recusada"
                "cancelar" -> "Corrida cancelada"
                "finalizar" -> "Corrida finalizada"
                else -> "Acao concluida"
              }}

              Toast.makeText(this, mensagem, Toast.LENGTH_LONG).show()

              if (acao == "cancelar" || acao == "finalizar") {{
                abrirAppPrincipal()
              }}

              intent.replaceExtras(android.os.Bundle())
              finishAndRemoveTask()
            }}
          }} else {{
            cancelarNotificacao()
            Toast.makeText(this, "Chamada indisponivel", Toast.LENGTH_LONG).show()
            intent.replaceExtras(android.os.Bundle())
            finishAndRemoveTask()
          }}
        }}
      }} catch (e: Exception) {{
        runOnUiThread {{
          Toast.makeText(this, "Erro: " + e.message, Toast.LENGTH_LONG).show()
          finish()
        }}
      }}
    }}.start()
  }}

  private fun cancelarNotificacao() {{
    try {{
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

      val notificationId = intent.getIntExtra("notificationId", 0)
      if (notificationId != 0) {{
        manager.cancel(notificationId)
      }}

      // Limpeza defensiva: remove qualquer vestigio de notificacao/fullscreen antigo.
      manager.cancelAll()
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
print("CornelioIncomingCallActivity criada")

service_file = main.parent / "CornelioFirebaseMessagingService.kt"

service_code = f'''package {package_name}

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class CornelioFirebaseMessagingService : FirebaseMessagingService() {{

  override fun onMessageReceived(remoteMessage: RemoteMessage) {{
    super.onMessageReceived(remoteMessage)

    val data = remoteMessage.data

    if (data["tipo"] != "nova_corrida_motorista") {{
      return
    }}

    acordarTela()
    mostrarNotificacaoCorrida(data)
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

  private fun mostrarNotificacaoCorrida(data: Map<String, String>) {{
    val channelId = "corridas_urgentes_v10"
    val notificationId = try {
      kotlin.math.abs(("corrida-" + (data["idChamada"] ?: "")).hashCode())
    } catch (_: Exception) {
      991199
    }

    criarCanal(channelId)

    val callIntent = Intent(this, CornelioIncomingCallActivity::class.java)
    callIntent.addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP
    )

    for ((key, value) in data) {{
      callIntent.putExtra(key, value)
    }}

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
      .setOngoing(false)
      .setAutoCancel(true)
      .setTimeoutAfter(45000)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setVibrate(longArrayOf(0, 700, 300, 700, 300, 700))
      .setContentIntent(fullScreenPendingIntent)
      .setFullScreenIntent(fullScreenPendingIntent, true)
      .build()

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(notificationId, notification)
  }}

  private fun criarCanal(channelId: String) {{
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
print("CornelioFirebaseMessagingService atualizado")

manifest = Path("android/app/src/main/AndroidManifest.xml")
text = manifest.read_text(encoding="utf-8")

activity_decl = '''    <activity
      android:name=".CornelioIncomingCallActivity"
      android:exported="false"
      android:excludeFromRecents="true"
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
print("Manifest atualizado")
