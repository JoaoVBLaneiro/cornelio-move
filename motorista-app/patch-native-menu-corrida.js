const fs = require("fs");

const p = "patch-native-fcm-service.py";
let s = fs.readFileSync(p, "utf8");

s = s.replace(
  "import android.os.Bundle\n",
  "import android.os.Bundle\nimport android.net.Uri\n"
);

s = s.replace(
  "import java.net.URL\n",
  "import java.net.URL\nimport java.net.URLEncoder\n"
);

s = s.replace(
`    Handler(Looper.getMainLooper()).postDelayed({{
      finish()
    }}, 45000)
`,
""
);

const blocoMenu = `
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

`;

if (!s.includes("private fun montarTelaCorridaAceita()")) {
  s = s.replace("  private fun enviarAcao(acao: String) {{", blocoMenu + "  private fun enviarAcao(acao: String) {{");
}

const antigo = `        runOnUiThread {{
          cancelarNotificacao()

          if (ok) {{
            Toast.makeText(
              this,
              if (acao == "aceitar") "Chamada aceita" else "Chamada recusada",
              Toast.LENGTH_LONG
            ).show()

            if (acao == "aceitar") {{
              abrirAppPrincipal()
            }}

            finish()
          }} else {{
            Toast.makeText(this, "Chamada indisponivel", Toast.LENGTH_LONG).show()
            finish()
          }}
        }}`;

const novo = `        runOnUiThread {{
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

              finish()
            }}
          }} else {{
            Toast.makeText(this, "Chamada indisponivel", Toast.LENGTH_LONG).show()
            finish()
          }}
        }}`;

if (!s.includes('montarTelaCorridaAceita()')) {
  throw new Error("Bloco de menu nao foi inserido.");
}

if (s.includes(antigo)) {
  s = s.replace(antigo, novo);
} else if (!s.includes('when (acao)')) {
  throw new Error("Bloco de sucesso antigo nao encontrado.");
}

s = s.replaceAll("corridas_urgentes_v8", "corridas_urgentes_v9");

fs.writeFileSync(p, s, "utf8");
console.log("patch-native-fcm-service.py atualizado com menu nativo da corrida aceita.");
