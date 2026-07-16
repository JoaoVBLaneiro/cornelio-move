const fs = require("fs");

const p = "patch-native-fcm-service.py";
let s = fs.readFileSync(p, "utf8");

const marcador = `package_name = package_line.replace("package ", "").strip()

`;

const blocoAppState = `package_name = package_line.replace("package ", "").strip()

app_state_file = main.parent / "CornelioAppForegroundState.kt"
app_state_code = f'''package {package_name}

object CornelioAppForegroundState {{
  @Volatile
  var emPrimeiroPlano: Boolean = false
}}
'''
app_state_file.write_text(app_state_code, encoding="utf-8")
print("CornelioAppForegroundState atualizado")

if "CornelioAppForegroundState.emPrimeiroPlano" not in main_text:
    insercao_main = '''
  override fun onResume() {
    super.onResume()
    CornelioAppForegroundState.emPrimeiroPlano = true
  }

  override fun onPause() {
    CornelioAppForegroundState.emPrimeiroPlano = false
    super.onPause()
  }
'''
    pos = main_text.rfind("\\n}")
    if pos < 0:
        raise SystemExit("Nao encontrei fechamento da classe MainActivity.kt")
    main_text = main_text[:pos] + insercao_main + main_text[pos:]
    main.write_text(main_text, encoding="utf-8")
    print("MainActivity atualizado com estado de primeiro plano")
else:
    print("MainActivity ja tinha estado de primeiro plano")

`;

if (!s.includes("CornelioAppForegroundState.kt")) {
  if (!s.includes(marcador)) {
    throw new Error("Nao encontrei o ponto para inserir CornelioAppForegroundState.");
  }

  s = s.replace(marcador, blocoAppState);
}

const trechoAntigo = `    acordarTela()
    mostrarNotificacaoCorrida(data)`;

const trechoNovo = `    if (CornelioAppForegroundState.emPrimeiroPlano) {{
      return
    }}

    acordarTela()
    mostrarNotificacaoCorrida(data)`;

if (!s.includes("CornelioAppForegroundState.emPrimeiroPlano) {{")) {
  if (!s.includes(trechoAntigo)) {
    throw new Error("Nao encontrei acordarTela()/mostrarNotificacaoCorrida(data).");
  }

  s = s.replace(trechoAntigo, trechoNovo);
}

fs.writeFileSync(p, s, "utf8");

console.log("Patch aplicado: app em primeiro plano nao mostra push nativo.");