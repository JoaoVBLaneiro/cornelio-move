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

# Garante dependencia direta do Firebase Messaging no modulo app
gradle_file = Path("android/app/build.gradle")
gradle_text = gradle_file.read_text(encoding="utf-8")

if "com.google.firebase:firebase-messaging" not in gradle_text:
    if "dependencies {" not in gradle_text:
        raise SystemExit("Bloco dependencies nao encontrado em android/app/build.gradle")

    gradle_text = gradle_text.replace(
        "dependencies {",
        """dependencies {
    implementation platform("com.google.firebase:firebase-bom:34.15.0")
    implementation "com.google.firebase:firebase-messaging"
""",
        1
    )

    gradle_file.write_text(gradle_text, encoding="utf-8")
    print("Dependencia com.google.firebase:firebase-messaging adicionada ao app/build.gradle")
else:
    print("Dependencia Firebase Messaging ja existia no app/build.gradle")

service_file = main.parent / "CornelioFirebaseMessagingService.kt"

service_code = f'''package {package_name}

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.net.URLEncoder

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
    }} catch (_: Exception) {{
    }}
  }}

  private fun enc(valor: String?): String {{
    return try {{
      URLEncoder.encode(valor ?: "", "UTF-8")
    }} catch (_: Exception) {{
      ""
    }}
  }}

  private fun montarUrlCorrida(data: Map<String, String>): String {{
    val campos = listOf(
      "idChamada",
      "tokenTentativa",
      "cliente",
      "endereco",
      "observacao",
      "latitudePassageiro",
      "longitudePassageiro",
      "distancia",
      "tempo",
      "origem"
    )

    val query = campos.joinToString("&") {{ campo ->
      campo + "=" + enc(data[campo])
    }}

    return "corneliomove://nova-corrida?" + query
  }}

  private fun mostrarNotificacaoCorrida(data: Map<String, String>) {{
    val channelId = "corridas_urgentes_v5"
    val notificationId = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()

    criarCanal(channelId)

    val urlCorrida = montarUrlCorrida(data)

    val launchIntent =
      packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)

    launchIntent.action = Intent.ACTION_VIEW
    launchIntent.data = Uri.parse(urlCorrida)

    launchIntent.addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP
    )

    for ((key, value) in data) {{
      launchIntent.putExtra(key, value)
    }}

    val flags =
      PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    val fullScreenPendingIntent = PendingIntent.getActivity(
      this,
      notificationId,
      launchIntent,
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
      .setTimeoutAfter(20000)
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
print("Servico FCM nativo criado em", service_file)

manifest = Path("android/app/src/main/AndroidManifest.xml")
text = manifest.read_text(encoding="utf-8")

service_decl = '''    <service
      android:name=".CornelioFirebaseMessagingService"
      android:exported="false">
      <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
      </intent-filter>
    </service>
'''

if "CornelioFirebaseMessagingService" not in text:
    text = text.replace("</application>", service_decl + "\n  </application>")

manifest.write_text(text, encoding="utf-8")
print("AndroidManifest.xml atualizado com servico FCM nativo")
